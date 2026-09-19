/**
 * Layout persistence (§A.6).
 *
 * Layouts are saved per **workspace tab** (Live / Edit), not globally, so
 * rearranging Live never disturbs Edit's arrangement.
 *
 * # Storage choice
 *
 * Two tiers, tried in order:
 *
 *   1. The active `WorkspaceProvider` (`layout.json` next to `workspace.json`),
 *      so a user's arrangement travels with their workspace folder.
 *   2. `localStorage` under `wms-layout-v1`, when no workspace has been chosen
 *      yet — which is always true on very first run, before the picker appears.
 *
 * `localStorage` is the *right* tool here and this is the one place it is
 * sanctioned: a dock layout is a few KB of JSON, synchronously readable during
 * first paint (avoiding a layout flash), and losing it is an inconvenience
 * rather than data loss. That is the opposite of video and pose data, which is
 * why Document 2 §10 bans localStorage for those. Called out explicitly so the
 * distinction is not mistaken for an inconsistency.
 *
 * # Versioning
 *
 * Stored blobs carry a schema version. A layout written by a future version is
 * ignored rather than fed to `fromJSON`, because dockview throws on a malformed
 * layout and a corrupt saved layout must never brick the app into a blank dock.
 */

export const LAYOUT_STORAGE_KEY = 'wms-layout-v1';
export const LAYOUT_SCHEMA_VERSION = 1;

/** The file written inside a workspace root, beside `workspace.json`. */
export const LAYOUT_FILE = 'layout.json';

/** Opaque dockview layout blob. Typed loosely on purpose — we never inspect it. */
export type SerializedLayout = Record<string, unknown>;

export interface StoredLayouts {
  version: number;
  /** Keyed by workspace-tab id ('live', 'edit'). */
  layouts: Record<string, SerializedLayout>;
  updatedAt: string;
}

/**
 * The subset of `WorkspaceProvider` this module needs.
 *
 * Declared structurally rather than imported from the app so `@wms/ui` stays
 * free of app dependencies — the package must remain independently testable.
 */
export interface LayoutStorageBackend {
  readText(path: string): Promise<string>;
  writeText(path: string, text: string): Promise<void>;
  exists(path: string): Promise<boolean>;
}

function emptyStore(): StoredLayouts {
  return { version: LAYOUT_SCHEMA_VERSION, layouts: {}, updatedAt: new Date().toISOString() };
}

/** Validates a parsed blob. Returns null for anything we should not trust. */
export function parseStoredLayouts(raw: string | null | undefined): StoredLayouts | null {
  if (!raw) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null) return null;

  const candidate = parsed as Partial<StoredLayouts>;
  if (typeof candidate.version !== 'number') return null;
  // A newer schema may contain structures this build cannot restore safely.
  if (candidate.version > LAYOUT_SCHEMA_VERSION) return null;
  if (typeof candidate.layouts !== 'object' || candidate.layouts === null) return null;

  return {
    version: candidate.version,
    layouts: candidate.layouts as Record<string, SerializedLayout>,
    updatedAt: typeof candidate.updatedAt === 'string' ? candidate.updatedAt : '',
  };
}

function readLocal(): StoredLayouts | null {
  try {
    return parseStoredLayouts(globalThis.localStorage?.getItem(LAYOUT_STORAGE_KEY));
  } catch {
    // Safari in private mode throws on localStorage access rather than
    // returning null. A missing layout is recoverable; a crash here is not.
    return null;
  }
}

function writeLocal(store: StoredLayouts): void {
  try {
    globalThis.localStorage?.setItem(LAYOUT_STORAGE_KEY, JSON.stringify(store));
  } catch {
    // Quota or private mode. The layout is a convenience, so swallow it.
  }
}

/**
 * Reads and writes layouts, preferring the workspace provider when one is set.
 *
 * The backend can be attached later via `setBackend` — the app starts with no
 * workspace and gains one when the user picks a folder, and layouts saved in the
 * meantime should migrate into it rather than being stranded in localStorage.
 */
export class LayoutStore {
  private backend: LayoutStorageBackend | null = null;

  constructor(backend?: LayoutStorageBackend | null) {
    this.backend = backend ?? null;
  }

  /**
   * Attaches (or clears) the workspace backend.
   *
   * When a backend is attached and holds no layout yet, whatever is in
   * localStorage is migrated into it, so choosing a folder does not appear to
   * reset the user's arrangement.
   */
  async setBackend(backend: LayoutStorageBackend | null): Promise<void> {
    this.backend = backend;
    if (!backend) return;
    try {
      if (await backend.exists(LAYOUT_FILE)) return;
      const local = readLocal();
      if (local && Object.keys(local.layouts).length > 0) {
        await backend.writeText(LAYOUT_FILE, JSON.stringify(local, null, 2));
      }
    } catch {
      // Migration is best-effort; a failure just means the defaults load.
    }
  }

  private async readAll(): Promise<StoredLayouts> {
    if (this.backend) {
      try {
        if (await this.backend.exists(LAYOUT_FILE)) {
          const parsed = parseStoredLayouts(await this.backend.readText(LAYOUT_FILE));
          if (parsed) return parsed;
        }
      } catch {
        // Fall through to localStorage rather than failing to load any layout.
      }
    }
    return readLocal() ?? emptyStore();
  }

  /** Returns the saved layout for a workspace tab, or null to use the default. */
  async load(tabId: string): Promise<SerializedLayout | null> {
    const store = await this.readAll();
    return store.layouts[tabId] ?? null;
  }

  async save(tabId: string, layout: SerializedLayout): Promise<void> {
    const store = await this.readAll();
    store.layouts[tabId] = layout;
    store.updatedAt = new Date().toISOString();
    store.version = LAYOUT_SCHEMA_VERSION;

    // Always mirror to localStorage: it is the only tier readable synchronously
    // on next boot, and it keeps the layout if the user later detaches the
    // workspace folder.
    writeLocal(store);

    if (this.backend) {
      try {
        await this.backend.writeText(LAYOUT_FILE, JSON.stringify(store, null, 2));
      } catch {
        // localStorage already has it; a folder write failure is not fatal.
      }
    }
  }

  /** Clears one tab's layout (used by "Reset Layout to Default"). */
  async clear(tabId: string): Promise<void> {
    const store = await this.readAll();
    delete store.layouts[tabId];
    store.updatedAt = new Date().toISOString();
    writeLocal(store);
    if (this.backend) {
      try {
        await this.backend.writeText(LAYOUT_FILE, JSON.stringify(store, null, 2));
      } catch {
        /* see above */
      }
    }
  }

  /** Clears every saved layout in both tiers. */
  async clearAll(): Promise<void> {
    const store = emptyStore();
    writeLocal(store);
    if (this.backend) {
      try {
        await this.backend.writeText(LAYOUT_FILE, JSON.stringify(store, null, 2));
      } catch {
        /* see above */
      }
    }
  }
}

/**
 * Trailing-edge debounce for layout writes.
 *
 * dockview fires `onDidLayoutChange` on every pixel of a drag; without this a
 * single resize would issue hundreds of writes, which on the `fsa` tier means
 * hundreds of real disk writes.
 */
export function debounceLayoutSave(
  save: (layout: SerializedLayout) => void,
  delayMs = 500,
): { schedule: (layout: SerializedLayout) => void; flush: () => void; cancel: () => void } {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let pending: SerializedLayout | null = null;

  const cancel = () => {
    if (timer !== null) clearTimeout(timer);
    timer = null;
    pending = null;
  };

  return {
    schedule(layout) {
      pending = layout;
      if (timer !== null) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        if (pending) {
          const toSave = pending;
          pending = null;
          save(toSave);
        }
      }, delayMs);
    },
    /** Writes immediately — call on unload so a drag in progress is not lost. */
    flush() {
      if (timer !== null) clearTimeout(timer);
      timer = null;
      if (pending) {
        const toSave = pending;
        pending = null;
        save(toSave);
      }
    },
    cancel,
  };
}
