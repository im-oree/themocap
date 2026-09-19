/**
 * Origin Private File System provider — the middle tier.
 *
 * Same directory/file model as `fsa` and the same streaming writes, but the root
 * is browser-managed and invisible to the user. Needs no picker and no gesture,
 * which makes it the right default when `fsa` is unavailable.
 *
 * The tradeoff to be honest about in the UI: the user cannot open these files in
 * Finder, and clearing site data destroys them. Exporting a take out of OPFS is a
 * download, not a folder.
 */

import {
  normalizePath,
  splitPath,
  WorkspaceError,
  type WorkspaceEntry,
  type WorkspaceProvider,
  type WorkspaceWriter,
} from '../types';

interface OpfsWritable {
  write(data: BufferSource | Blob | string): Promise<void>;
  close(): Promise<void>;
  abort(reason?: unknown): Promise<void>;
}
interface OpfsFileHandle {
  kind: 'file';
  name: string;
  getFile(): Promise<File>;
  createWritable(options?: { keepExistingData?: boolean }): Promise<OpfsWritable>;
}
interface OpfsDirHandle {
  kind: 'directory';
  name: string;
  getDirectoryHandle(name: string, options?: { create?: boolean }): Promise<OpfsDirHandle>;
  getFileHandle(name: string, options?: { create?: boolean }): Promise<OpfsFileHandle>;
  removeEntry(name: string, options?: { recursive?: boolean }): Promise<void>;
  entries(): AsyncIterableIterator<[string, OpfsFileHandle | OpfsDirHandle]>;
}

// The DOM lib types `getDirectory` as returning the standard handle, which lacks
// the async-iterator `entries()` every engine actually ships. Narrow to our own
// structural type rather than casting at each call site.
type OpfsStorageManager = Omit<StorageManager, 'getDirectory'> & {
  getDirectory?: () => Promise<OpfsDirHandle>;
};

export function isOpfsSupported(): boolean {
  return (
    typeof navigator !== 'undefined' &&
    typeof (navigator.storage as unknown as OpfsStorageManager | undefined)?.getDirectory === 'function'
  );
}

export class OpfsWorkspaceProvider implements WorkspaceProvider {
  readonly id = 'opfs' as const;
  readonly label = 'Browser storage (private folder)';
  private root: OpfsDirHandle | null = null;

  isReady(): boolean {
    return this.root !== null;
  }

  async requestAccess(): Promise<void> {
    const storage = navigator.storage as unknown as OpfsStorageManager | undefined;
    if (!storage?.getDirectory) {
      throw new WorkspaceError('Origin Private File System is not available', 'unsupported');
    }
    this.root = await storage.getDirectory();
  }

  private async requireRoot(): Promise<OpfsDirHandle> {
    if (!this.root) await this.requestAccess();
    if (!this.root) throw new WorkspaceError('OPFS root unavailable', 'not-ready');
    return this.root;
  }

  private async dirHandle(parts: string[], create: boolean): Promise<OpfsDirHandle> {
    let dir = await this.requireRoot();
    for (const part of parts) {
      try {
        dir = await dir.getDirectoryHandle(part, { create });
      } catch (cause) {
        throw new WorkspaceError(`Directory not found: ${parts.join('/')}`, 'not-found', {
          cause,
        });
      }
    }
    return dir;
  }

  private async fileHandle(path: string, create: boolean): Promise<OpfsFileHandle> {
    const { dir, name } = splitPath(path);
    const parent = await this.dirHandle(dir, create);
    try {
      return await parent.getFileHandle(name, { create });
    } catch (cause) {
      throw new WorkspaceError(`File not found: ${path}`, 'not-found', { cause });
    }
  }

  async mkdirp(path: string): Promise<void> {
    await this.dirHandle(normalizePath(path), true);
  }

  async writeFile(path: string, data: Uint8Array | Blob): Promise<void> {
    const handle = await this.fileHandle(path, true);
    const writable = await handle.createWritable();
    try {
      await writable.write(data instanceof Blob ? data : copyToArrayBuffer(data));
      await writable.close();
    } catch (cause) {
      await writable.abort(cause).catch(() => undefined);
      throw wrapQuota(path, cause);
    }
  }

  async createWriter(path: string): Promise<WorkspaceWriter> {
    const handle = await this.fileHandle(path, true);
    const writable = await handle.createWritable();
    let closed = false;
    return {
      async write(chunk) {
        if (closed) throw new WorkspaceError(`Writer for ${path} is closed`, 'not-ready');
        try {
          await writable.write(chunk instanceof Blob ? chunk : copyToArrayBuffer(chunk));
        } catch (cause) {
          throw wrapQuota(path, cause);
        }
      },
      async close() {
        if (closed) return;
        closed = true;
        await writable.close();
      },
      async abort() {
        if (closed) return;
        closed = true;
        await writable.abort().catch(() => undefined);
      },
    };
  }

  async readFile(path: string): Promise<Uint8Array> {
    const file = await (await this.fileHandle(path, false)).getFile();
    return new Uint8Array(await file.arrayBuffer());
  }

  async readText(path: string): Promise<string> {
    return (await (await this.fileHandle(path, false)).getFile()).text();
  }

  async writeText(path: string, text: string): Promise<void> {
    await this.writeFile(path, new TextEncoder().encode(text));
  }

  async exists(path: string): Promise<boolean> {
    try {
      const { dir, name } = splitPath(path);
      const parent = await this.dirHandle(dir, false);
      try {
        await parent.getFileHandle(name);
        return true;
      } catch {
        await parent.getDirectoryHandle(name);
        return true;
      }
    } catch {
      return false;
    }
  }

  async remove(path: string): Promise<void> {
    const { dir, name } = splitPath(path);
    const parent = await this.dirHandle(dir, false);
    try {
      await parent.removeEntry(name, { recursive: true });
    } catch (cause) {
      throw new WorkspaceError(`Could not remove ${path}`, 'not-found', { cause });
    }
  }

  async list(path: string): Promise<WorkspaceEntry[]> {
    const parts = path === '' || path === '/' ? [] : normalizePath(path);
    const dir = await this.dirHandle(parts, false);
    const out: WorkspaceEntry[] = [];
    for await (const [name, handle] of dir.entries()) {
      out.push({ name, kind: handle.kind });
    }
    return out.sort((a, b) => a.name.localeCompare(b.name));
  }

  async usage(): Promise<number | null> {
    const estimate = await navigator.storage?.estimate?.();
    return estimate?.usage ?? null;
  }
}

function copyToArrayBuffer(data: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(data.byteLength);
  copy.set(data);
  return copy.buffer;
}

function wrapQuota(path: string, cause: unknown): WorkspaceError {
  const name = (cause as { name?: string } | null)?.name;
  if (name === 'QuotaExceededError') {
    return new WorkspaceError(
      `Browser storage quota exceeded writing ${path}. Free space or switch to a folder workspace.`,
      'quota',
      { cause },
    );
  }
  return new WorkspaceError(`Failed to write ${path}`, 'denied', { cause });
}
