/**
 * IndexedDB provider — the universal fallback.
 *
 * Every browser that can run the rest of the app has IndexedDB, so this tier
 * guarantees nobody is hard-blocked. It is chosen last because it is the worst:
 *
 * - **No real streaming.** `createWriter` buffers chunks in memory and commits
 *   one blob on `close()`. A long recording is therefore bounded by RAM, not by
 *   disk. The recorder surfaces this as a take-length warning.
 * - **No directories.** There is one object store keyed by full path string, and
 *   directories are synthesised: `list()` derives children by prefix scanning,
 *   and `mkdirp` records an explicit marker so an empty directory can still exist.
 *
 * Payloads are stored as `ArrayBuffer`, not `Blob`. Blobs are nominally
 * structured-cloneable, but Safari has a long history of bugs round-tripping them
 * through IndexedDB, and an ArrayBuffer clone is unambiguous everywhere. The cost
 * is that a Blob handed to `writeFile` is read into memory once on the way in —
 * which this tier already does anyway.
 *
 * The flat-keyed design is deliberate. Modelling a real tree in IndexedDB means
 * either recursive lookups on every access or a parent-pointer table to keep
 * consistent; prefix scanning over a sorted keyPath does the same job with one
 * cursor and no invariants to violate.
 */

import {
  normalizePath,
  WorkspaceError,
  type WorkspaceEntry,
  type WorkspaceProvider,
  type WorkspaceWriter,
} from '../types';

const DB_NAME = 'wms-workspace';
const DB_VERSION = 1;
const STORE = 'files';

interface StoredFile {
  path: string;
  kind: 'file' | 'directory';
  data: ArrayBuffer | null;
  size: number;
  updatedAt: number;
}

export function isIdbSupported(): boolean {
  return typeof indexedDB !== 'undefined';
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: 'path' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () =>
      reject(new WorkspaceError('Could not open the workspace database', 'denied'));
  });
}

function promisify<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('IndexedDB request failed'));
  });
}

export class IdbWorkspaceProvider implements WorkspaceProvider {
  readonly id = 'idb-fallback' as const;
  readonly label = 'Browser database (fallback)';
  private db: IDBDatabase | null = null;

  isReady(): boolean {
    return this.db !== null;
  }

  async requestAccess(): Promise<void> {
    if (!isIdbSupported()) {
      throw new WorkspaceError('IndexedDB is not available', 'unsupported');
    }
    this.db = await openDb();
  }

  private async requireDb(): Promise<IDBDatabase> {
    if (!this.db) await this.requestAccess();
    if (!this.db) throw new WorkspaceError('Workspace database unavailable', 'not-ready');
    return this.db;
  }

  private key(path: string): string {
    return normalizePath(path).join('/');
  }

  private async put(record: StoredFile): Promise<void> {
    const db = await this.requireDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put(record);
      tx.oncomplete = () => resolve();
      tx.onerror = () => {
        const name = tx.error?.name;
        reject(
          name === 'QuotaExceededError'
            ? new WorkspaceError(
                `Browser storage quota exceeded writing ${record.path}`,
                'quota',
                { cause: tx.error },
              )
            : new WorkspaceError(`Failed to write ${record.path}`, 'denied', { cause: tx.error }),
        );
      };
    });
  }

  private async get(path: string): Promise<StoredFile | undefined> {
    const db = await this.requireDb();
    const tx = db.transaction(STORE, 'readonly');
    return promisify<StoredFile | undefined>(
      tx.objectStore(STORE).get(path) as IDBRequest<StoredFile | undefined>,
    );
  }

  /** Records directory markers for every ancestor, so `list` can see empty dirs. */
  private async ensureParents(parts: string[]): Promise<void> {
    for (let i = 1; i <= parts.length; i += 1) {
      const dirPath = parts.slice(0, i).join('/');
      if (!(await this.get(dirPath))) {
        await this.put({
          path: dirPath,
          kind: 'directory',
          data: null,
          size: 0,
          updatedAt: Date.now(),
        });
      }
    }
  }

  async mkdirp(path: string): Promise<void> {
    await this.ensureParents(normalizePath(path));
  }

  async writeFile(path: string, data: Uint8Array | Blob): Promise<void> {
    const parts = normalizePath(path);
    await this.ensureParents(parts.slice(0, -1));
    const buffer = data instanceof Blob ? await data.arrayBuffer() : toBlobPart(data);
    await this.put({
      path: parts.join('/'),
      kind: 'file',
      data: buffer,
      size: buffer.byteLength,
      updatedAt: Date.now(),
    });
  }

  /**
   * Buffers chunks and commits on `close()`.
   *
   * This is the tier's defining limitation: peak memory is the size of the file.
   * `abort()` simply drops the buffer, which makes cancelling a recording free —
   * the only thing this backend does better than the other two.
   */
  async createWriter(path: string): Promise<WorkspaceWriter> {
    const chunks: Blob[] = [];
    let closed = false;
    const commit = (blob: Blob) => this.writeFile(path, blob);
    return {
      async write(chunk) {
        if (closed) throw new WorkspaceError(`Writer for ${path} is closed`, 'not-ready');
        chunks.push(chunk instanceof Blob ? chunk : new Blob([toBlobPart(chunk)]));
      },
      async close() {
        if (closed) return;
        closed = true;
        await commit(new Blob(chunks));
      },
      async abort() {
        closed = true;
        chunks.length = 0;
      },
    };
  }

  async readFile(path: string): Promise<Uint8Array> {
    const record = await this.get(this.key(path));
    if (!record || record.kind !== 'file' || !record.data) {
      throw new WorkspaceError(`File not found: ${path}`, 'not-found');
    }
    return new Uint8Array(record.data);
  }

  async readText(path: string): Promise<string> {
    const record = await this.get(this.key(path));
    if (!record || record.kind !== 'file' || !record.data) {
      throw new WorkspaceError(`File not found: ${path}`, 'not-found');
    }
    return new TextDecoder().decode(new Uint8Array(record.data));
  }

  async writeText(path: string, text: string): Promise<void> {
    await this.writeFile(path, new TextEncoder().encode(text));
  }

  async exists(path: string): Promise<boolean> {
    return (await this.get(this.key(path))) !== undefined;
  }

  /** Removes a path and, if it is a directory, everything beneath it. */
  async remove(path: string): Promise<void> {
    const key = this.key(path);
    const db = await this.requireDb();
    const prefix = `${key}/`;
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      const store = tx.objectStore(STORE);
      store.delete(key);
      const cursorRequest = store.openCursor(IDBKeyRange.bound(prefix, `${prefix}\uffff`));
      cursorRequest.onsuccess = () => {
        const cursor = cursorRequest.result;
        if (cursor) {
          cursor.delete();
          cursor.continue();
        }
      };
      tx.oncomplete = () => resolve();
      tx.onerror = () =>
        reject(new WorkspaceError(`Could not remove ${path}`, 'denied', { cause: tx.error }));
    });
  }

  /**
   * Lists immediate children by prefix scan.
   *
   * Only direct children are returned: `a/b` is a child of `a`, `a/b/c` is not.
   * Intermediate directories are included even without an explicit marker, so a
   * tree written purely via `writeFile` still lists correctly.
   */
  async list(path: string): Promise<WorkspaceEntry[]> {
    const db = await this.requireDb();
    const isRoot = path === '' || path === '/';
    const prefix = isRoot ? '' : `${this.key(path)}/`;

    const keys = await new Promise<StoredFile[]>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readonly');
      const range = isRoot ? undefined : IDBKeyRange.bound(prefix, `${prefix}\uffff`);
      const request = tx.objectStore(STORE).getAll(range);
      request.onsuccess = () => resolve(request.result as StoredFile[]);
      request.onerror = () =>
        reject(new WorkspaceError(`Could not list ${path}`, 'not-found', { cause: request.error }));
    });

    const children = new Map<string, WorkspaceEntry>();
    for (const record of keys) {
      const rest = record.path.slice(prefix.length);
      if (rest.length === 0) continue;
      const slash = rest.indexOf('/');
      if (slash === -1) {
        children.set(rest, { name: rest, kind: record.kind });
      } else {
        const name = rest.slice(0, slash);
        // A deeper entry implies this directory exists even with no marker row.
        if (!children.has(name)) children.set(name, { name, kind: 'directory' });
      }
    }
    return [...children.values()].sort((a, b) => a.name.localeCompare(b.name));
  }

  async usage(): Promise<number | null> {
    const estimate = await navigator.storage?.estimate?.();
    return estimate?.usage ?? null;
  }

  /** Test/maintenance helper: drops the entire store. */
  async clear(): Promise<void> {
    const db = await this.requireDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).clear();
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }
}

/**
 * Copies into a fresh, non-shared ArrayBuffer.
 *
 * Ring-buffer views are backed by SharedArrayBuffer, which both `Blob` and
 * structured clone reject, and subarrays carry their whole parent buffer.
 */
function toBlobPart(data: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(data.byteLength);
  copy.set(data);
  return copy.buffer;
}

