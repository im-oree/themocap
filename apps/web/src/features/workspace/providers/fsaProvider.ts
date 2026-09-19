/**
 * File System Access provider — the preferred tier.
 *
 * Writes takes into a real directory the user picked, so the output is visible in
 * Finder/Explorer and can be dragged into Blender without an export-download
 * dance. Chromium-only today.
 *
 * Two constraints shape this file:
 *
 * 1. `showDirectoryPicker()` must be called from a user gesture, so access is
 *    requested explicitly via `requestAccess()` rather than lazily on first write.
 * 2. The handle is not structured-cloneable into `localStorage`, but it *is*
 *    IndexedDB-serialisable. Persisting it there lets us re-acquire the same
 *    folder on reload with only a permission re-prompt instead of a re-pick.
 */

import {
  normalizePath,
  splitPath,
  WorkspaceError,
  type WorkspaceEntry,
  type WorkspaceProvider,
  type WorkspaceWriter,
} from '../types';

// The DOM lib in this TS version does not ship File System Access types.
interface FileSystemWritableStream {
  write(data: BufferSource | Blob | string): Promise<void>;
  close(): Promise<void>;
  abort(reason?: unknown): Promise<void>;
}
interface FsFileHandle {
  kind: 'file';
  name: string;
  getFile(): Promise<File>;
  createWritable(options?: { keepExistingData?: boolean }): Promise<FileSystemWritableStream>;
}
interface FsDirectoryHandle {
  kind: 'directory';
  name: string;
  getDirectoryHandle(name: string, options?: { create?: boolean }): Promise<FsDirectoryHandle>;
  getFileHandle(name: string, options?: { create?: boolean }): Promise<FsFileHandle>;
  removeEntry(name: string, options?: { recursive?: boolean }): Promise<void>;
  queryPermission?(descriptor: { mode: 'read' | 'readwrite' }): Promise<PermissionState>;
  requestPermission?(descriptor: { mode: 'read' | 'readwrite' }): Promise<PermissionState>;
  entries(): AsyncIterableIterator<[string, FsFileHandle | FsDirectoryHandle]>;
}

type PickerWindow = Window & {
  showDirectoryPicker?: (options?: {
    mode?: 'read' | 'readwrite';
    id?: string;
    startIn?: string;
  }) => Promise<FsDirectoryHandle>;
};

export function isFsaSupported(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof (window as PickerWindow).showDirectoryPicker === 'function'
  );
}

export class FsaWorkspaceProvider implements WorkspaceProvider {
  readonly id = 'fsa' as const;
  private root: FsDirectoryHandle | null = null;

  constructor(existingRoot?: FsDirectoryHandle) {
    this.root = existingRoot ?? null;
  }

  get label(): string {
    return this.root ? `Folder: ${this.root.name}` : 'Folder: not chosen';
  }

  isReady(): boolean {
    return this.root !== null;
  }

  /** Shows the directory picker. Must be called from a user gesture. */
  async requestAccess(): Promise<void> {
    const picker = (window as PickerWindow).showDirectoryPicker;
    if (!picker) {
      throw new WorkspaceError('File System Access is not available', 'unsupported');
    }
    try {
      this.root = await picker.call(window, {
        mode: 'readwrite',
        id: 'wms-workspace',
        startIn: 'documents',
      });
    } catch (cause) {
      // AbortError means the user closed the picker — not an error worth shouting
      // about, but the caller still needs to know no root was obtained.
      throw new WorkspaceError('Folder selection was cancelled', 'denied', { cause });
    }
    await this.ensurePermission();
  }

  /** Re-verifies write permission on a handle restored from IndexedDB. */
  async ensurePermission(): Promise<void> {
    const root = this.requireRoot();
    const descriptor = { mode: 'readwrite' } as const;
    const current = (await root.queryPermission?.(descriptor)) ?? 'granted';
    if (current === 'granted') return;
    const granted = (await root.requestPermission?.(descriptor)) ?? 'denied';
    if (granted !== 'granted') {
      throw new WorkspaceError('Write permission for the workspace folder was denied', 'denied');
    }
  }

  /** The underlying handle, for persisting into IndexedDB. */
  getRootHandle(): FsDirectoryHandle | null {
    return this.root;
  }

  private requireRoot(): FsDirectoryHandle {
    if (!this.root) {
      throw new WorkspaceError('No workspace folder has been chosen yet', 'not-ready');
    }
    return this.root;
  }

  private async dirHandle(parts: string[], create: boolean): Promise<FsDirectoryHandle> {
    let dir = this.requireRoot();
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

  private async fileHandle(path: string, create: boolean): Promise<FsFileHandle> {
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
      await writable.write(data instanceof Blob ? data : toArrayBuffer(data));
      await writable.close();
    } catch (cause) {
      await writable.abort(cause).catch(() => undefined);
      throw wrapWriteError(path, cause);
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
          await writable.write(chunk instanceof Blob ? chunk : toArrayBuffer(chunk));
        } catch (cause) {
          throw wrapWriteError(path, cause);
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
    const handle = await this.fileHandle(path, false);
    const file = await handle.getFile();
    return new Uint8Array(await file.arrayBuffer());
  }

  async readText(path: string): Promise<string> {
    const handle = await this.fileHandle(path, false);
    return (await handle.getFile()).text();
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
    // A user-chosen folder is not covered by the storage-quota API, and walking
    // the whole tree to total it up would be slow and misleading. Report unknown.
    return null;
  }
}

function toArrayBuffer(data: Uint8Array): ArrayBuffer {
  // Ring-buffer views are backed by SharedArrayBuffer, which `write()` rejects,
  // and subarray views carry the whole parent buffer. Copy to a tight ArrayBuffer.
  const copy = new Uint8Array(data.byteLength);
  copy.set(data);
  return copy.buffer;
}

function wrapWriteError(path: string, cause: unknown): WorkspaceError {
  const name = (cause as { name?: string } | null)?.name;
  if (name === 'QuotaExceededError') {
    return new WorkspaceError(`Out of disk space writing ${path}`, 'quota', { cause });
  }
  if (name === 'NotAllowedError') {
    return new WorkspaceError(`Permission denied writing ${path}`, 'denied', { cause });
  }
  return new WorkspaceError(`Failed to write ${path}`, 'denied', { cause });
}
