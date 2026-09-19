/**
 * Workspace storage abstraction.
 *
 * The app must run fully offline and keep potentially large recordings (video +
 * pose binaries) somewhere durable. Browsers offer three very different answers
 * to that, with very different UX, so we define one interface and three backends:
 *
 * | Tier          | API                      | Where it lands         | Caveat                         |
 * | ------------- | ------------------------ | ---------------------- | ------------------------------ |
 * | `fsa`         | File System Access       | A real user-chosen dir | Chromium only; needs a gesture |
 * | `opfs`        | Origin Private FS        | Browser-managed sandbox| Invisible to the user          |
 * | `idb-fallback`| IndexedDB blobs          | Browser-managed sandbox| Slowest; no streaming writes   |
 *
 * `fsa` is strongly preferred: takes land in a folder the user can open in
 * Finder/Explorer, which matters enormously for a tool whose whole output is
 * files you take somewhere else. `opfs` is the good-enough fallback (still fast,
 * still supports streaming writes, just hidden). `idb-fallback` exists so Safari
 * and Firefox users are never hard-blocked, and is chosen last because it must
 * buffer whole files in memory.
 *
 * Detection picks the best available tier, but the user can override it — see
 * `selectProvider`. An override is honoured even when a better tier exists,
 * because "put my recordings in this folder" is a legitimate preference.
 */

/** Identifier for a storage backend. Persisted in settings, so do not rename. */
export type WorkspaceProviderId = 'fsa' | 'opfs' | 'idb-fallback';

export interface WorkspaceCapabilities {
  /** Backends this browser can actually use, best first. */
  available: WorkspaceProviderId[];
  /** What detection would choose with no user override. */
  preferred: WorkspaceProviderId;
  /** True when the tier needs an explicit user gesture before it can be used. */
  requiresUserGesture: boolean;
}

/** A file or directory entry inside the workspace. */
export interface WorkspaceEntry {
  name: string;
  kind: 'file' | 'directory';
}

/**
 * A sink for incrementally written bytes.
 *
 * Streaming matters: a ten-minute recording must not be held in memory before it
 * is written. `fsa` and `opfs` stream natively; `idb-fallback` emulates this by
 * buffering and is therefore the tier that constrains maximum take length.
 */
export interface WorkspaceWriter {
  write(chunk: Uint8Array | Blob): Promise<void>;
  close(): Promise<void>;
  /** Discards a partially written file. Used when a recording is cancelled. */
  abort(): Promise<void>;
}

/**
 * Storage backend. Paths are always `/`-separated and relative to the workspace
 * root; leading slashes are ignored and `..` is rejected.
 */
export interface WorkspaceProvider {
  readonly id: WorkspaceProviderId;
  /** Human-readable location, shown in the workspace badge. */
  readonly label: string;
  /** True once the provider has a usable root (an `fsa` provider needs a pick first). */
  isReady(): boolean;
  /**
   * Obtains a root. For `fsa` this shows the directory picker and MUST be called
   * from a user gesture; the others resolve immediately.
   */
  requestAccess(): Promise<void>;

  writeFile(path: string, data: Uint8Array | Blob): Promise<void>;
  createWriter(path: string): Promise<WorkspaceWriter>;
  readFile(path: string): Promise<Uint8Array>;
  readText(path: string): Promise<string>;
  writeText(path: string, text: string): Promise<void>;
  exists(path: string): Promise<boolean>;
  remove(path: string): Promise<void>;
  list(path: string): Promise<WorkspaceEntry[]>;
  mkdirp(path: string): Promise<void>;
  /** Bytes used, when the browser will tell us. Null when unknown. */
  usage(): Promise<number | null>;
}

export class WorkspaceError extends Error {
  constructor(
    message: string,
    readonly code:
      | 'not-ready'
      | 'not-found'
      | 'denied'
      | 'unsupported'
      | 'invalid-path'
      | 'quota',
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = 'WorkspaceError';
  }
}

/**
 * Normalises and validates a workspace-relative path.
 *
 * Rejects `..` outright rather than resolving it: with `fsa` the root is a real
 * directory on the user's disk, and a traversal bug there writes to arbitrary
 * places in their home folder. There is no legitimate use for `..` in a path the
 * app constructs itself.
 */
export function normalizePath(path: string): string[] {
  const parts = path.split('/').filter((p) => p.length > 0 && p !== '.');
  for (const part of parts) {
    if (part === '..') {
      throw new WorkspaceError(`Path escapes the workspace root: ${path}`, 'invalid-path');
    }
    if (part.includes('\0')) {
      throw new WorkspaceError(`Path contains a null byte: ${path}`, 'invalid-path');
    }
  }
  if (parts.length === 0) {
    throw new WorkspaceError(`Empty path`, 'invalid-path');
  }
  return parts;
}

/** Splits a path into its directory segments and final name. */
export function splitPath(path: string): { dir: string[]; name: string } {
  const parts = normalizePath(path);
  const name = parts.pop()!;
  return { dir: parts, name };
}
