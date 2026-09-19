/**
 * An in-memory stand-in for the File System Access / OPFS directory handle API.
 *
 * jsdom implements neither, so without this the `fsa` and `opfs` providers could
 * only be tested in a real browser — and §17 requires all three storage tiers to
 * be tested. This fake implements the subset both providers actually call
 * (`getDirectoryHandle`, `getFileHandle`, `createWritable`, `removeEntry`,
 * `entries`, `getFile`) with the same error behaviour: a missing entry rejects
 * rather than returning undefined, and `create: false` never conjures anything.
 *
 * It is not a full spec implementation and is not meant to be. It exists so that
 * provider *logic* — path handling, mkdirp, streaming writes, aborts, listing —
 * is covered; browser conformance is the e2e suite's job.
 */

export class MemoryFileHandle {
  readonly kind = 'file' as const;
  constructor(
    readonly name: string,
    public data: Uint8Array = new Uint8Array(0),
  ) {}

  async getFile(): Promise<File> {
    // Copy so a later write cannot mutate a File the test is still holding.
    return new File([this.data.slice()], this.name);
  }

  async createWritable(options?: { keepExistingData?: boolean }) {
    const commit = (bytes: Uint8Array) => {
      this.data = bytes;
    };
    const chunks: Uint8Array[] = options?.keepExistingData ? [this.data.slice()] : [];
    let done = false;
    return {
      async write(data: BufferSource | Blob | string) {
        if (done) throw new Error('write after close');
        chunks.push(await toBytes(data));
      },
      async close() {
        if (done) return;
        done = true;
        const total = chunks.reduce((n, c) => n + c.byteLength, 0);
        const merged = new Uint8Array(total);
        let offset = 0;
        for (const chunk of chunks) {
          merged.set(chunk, offset);
          offset += chunk.byteLength;
        }
        commit(merged);
      },
      async abort() {
        // Aborting must leave the previous contents intact, not a truncated file.
        done = true;
        chunks.length = 0;
      },
    };
  }
}

export class MemoryDirectoryHandle {
  readonly kind = 'directory' as const;
  private children = new Map<string, MemoryFileHandle | MemoryDirectoryHandle>();
  /** Set by tests to simulate a revoked or never-granted permission. */
  permission: PermissionState = 'granted';

  constructor(readonly name: string = 'workspace') {}

  async getDirectoryHandle(
    name: string,
    options?: { create?: boolean },
  ): Promise<MemoryDirectoryHandle> {
    const existing = this.children.get(name);
    if (existing) {
      if (existing.kind !== 'directory') {
        throw new DomError('TypeMismatchError', `${name} is a file`);
      }
      return existing;
    }
    if (!options?.create) throw new DomError('NotFoundError', `${name} not found`);
    const created = new MemoryDirectoryHandle(name);
    this.children.set(name, created);
    return created;
  }

  async getFileHandle(name: string, options?: { create?: boolean }): Promise<MemoryFileHandle> {
    const existing = this.children.get(name);
    if (existing) {
      if (existing.kind !== 'file') {
        throw new DomError('TypeMismatchError', `${name} is a directory`);
      }
      return existing;
    }
    if (!options?.create) throw new DomError('NotFoundError', `${name} not found`);
    const created = new MemoryFileHandle(name);
    this.children.set(name, created);
    return created;
  }

  async removeEntry(name: string, _options?: { recursive?: boolean }): Promise<void> {
    if (!this.children.has(name)) throw new DomError('NotFoundError', `${name} not found`);
    this.children.delete(name);
  }

  async *entries(): AsyncIterableIterator<
    [string, MemoryFileHandle | MemoryDirectoryHandle]
  > {
    for (const entry of [...this.children.entries()]) yield entry;
  }

  async queryPermission(): Promise<PermissionState> {
    return this.permission;
  }

  async requestPermission(): Promise<PermissionState> {
    return this.permission;
  }
}

/** Mimics a DOMException closely enough for the providers' `name` checks. */
class DomError extends Error {
  constructor(
    override readonly name: string,
    message: string,
  ) {
    super(message);
  }
}

async function toBytes(data: BufferSource | Blob | string): Promise<Uint8Array> {
  if (typeof data === 'string') return new TextEncoder().encode(data);
  if (data instanceof Blob) return new Uint8Array(await data.arrayBuffer());
  if (ArrayBuffer.isView(data)) {
    return new Uint8Array(data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength));
  }
  return new Uint8Array(data.slice(0));
}
