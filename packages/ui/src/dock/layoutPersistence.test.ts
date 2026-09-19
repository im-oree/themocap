import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  debounceLayoutSave,
  LAYOUT_FILE,
  LAYOUT_SCHEMA_VERSION,
  LAYOUT_STORAGE_KEY,
  LayoutStore,
  parseStoredLayouts,
  type LayoutStorageBackend,
} from './layoutPersistence';

/** Minimal in-memory stand-in for a WorkspaceProvider. */
function memoryBackend(seed: Record<string, string> = {}) {
  const files = new Map(Object.entries(seed));
  const backend: LayoutStorageBackend & { files: Map<string, string>; writes: number } = {
    files,
    writes: 0,
    async readText(path) {
      const value = files.get(path);
      if (value === undefined) throw new Error(`no such file: ${path}`);
      return value;
    },
    async writeText(path, textValue) {
      backend.writes += 1;
      files.set(path, textValue);
    },
    async exists(path) {
      return files.has(path);
    },
  };
  return backend;
}

const LIVE = { grid: { root: 'live-layout' } };
const EDIT = { grid: { root: 'edit-layout' } };

beforeEach(() => {
  globalThis.localStorage?.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('parseStoredLayouts', () => {
  it('returns null for empty or unparseable input', () => {
    expect(parseStoredLayouts(null)).toBeNull();
    expect(parseStoredLayouts('')).toBeNull();
    expect(parseStoredLayouts('{oh no')).toBeNull();
    expect(parseStoredLayouts('"a string"')).toBeNull();
    expect(parseStoredLayouts('null')).toBeNull();
  });

  it('rejects a blob with no version or no layouts map', () => {
    expect(parseStoredLayouts(JSON.stringify({ layouts: {} }))).toBeNull();
    expect(parseStoredLayouts(JSON.stringify({ version: 1 }))).toBeNull();
    expect(parseStoredLayouts(JSON.stringify({ version: 1, layouts: null }))).toBeNull();
  });

  it('refuses a layout written by a newer schema rather than risking fromJSON', () => {
    const future = JSON.stringify({ version: LAYOUT_SCHEMA_VERSION + 1, layouts: { live: LIVE } });
    expect(parseStoredLayouts(future)).toBeNull();
  });

  it('accepts a well-formed blob', () => {
    const parsed = parseStoredLayouts(
      JSON.stringify({ version: 1, layouts: { live: LIVE }, updatedAt: 'x' }),
    );
    expect(parsed?.layouts.live).toEqual(LIVE);
  });
});

describe('LayoutStore — localStorage tier', () => {
  it('returns null when nothing has been saved', async () => {
    await expect(new LayoutStore().load('live')).resolves.toBeNull();
  });

  it('round-trips a layout', async () => {
    const store = new LayoutStore();
    await store.save('live', LIVE);
    expect(await store.load('live')).toEqual(LIVE);
  });

  it('keeps each workspace tab independent', async () => {
    const store = new LayoutStore();
    await store.save('live', LIVE);
    await store.save('edit', EDIT);
    expect(await store.load('live')).toEqual(LIVE);
    expect(await store.load('edit')).toEqual(EDIT);
  });

  it('overwrites a tab without disturbing the others', async () => {
    const store = new LayoutStore();
    await store.save('live', LIVE);
    await store.save('edit', EDIT);
    await store.save('live', { grid: { root: 'changed' } });
    expect(await store.load('live')).toEqual({ grid: { root: 'changed' } });
    expect(await store.load('edit')).toEqual(EDIT);
  });

  it('clears one tab only', async () => {
    const store = new LayoutStore();
    await store.save('live', LIVE);
    await store.save('edit', EDIT);
    await store.clear('live');
    expect(await store.load('live')).toBeNull();
    expect(await store.load('edit')).toEqual(EDIT);
  });

  it('clears everything', async () => {
    const store = new LayoutStore();
    await store.save('live', LIVE);
    await store.save('edit', EDIT);
    await store.clearAll();
    expect(await store.load('live')).toBeNull();
    expect(await store.load('edit')).toBeNull();
  });

  it('writes a versioned envelope, not a bare layout', async () => {
    await new LayoutStore().save('live', LIVE);
    const raw = JSON.parse(globalThis.localStorage.getItem(LAYOUT_STORAGE_KEY)!);
    expect(raw.version).toBe(LAYOUT_SCHEMA_VERSION);
    expect(raw.layouts.live).toEqual(LIVE);
    expect(typeof raw.updatedAt).toBe('string');
  });

  it('ignores a corrupt localStorage blob instead of throwing', async () => {
    globalThis.localStorage.setItem(LAYOUT_STORAGE_KEY, 'not json');
    const store = new LayoutStore();
    await expect(store.load('live')).resolves.toBeNull();
    // ...and a later save repairs it.
    await store.save('live', LIVE);
    expect(await store.load('live')).toEqual(LIVE);
  });

  it('survives localStorage throwing (Safari private mode)', async () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new DOMException('denied', 'SecurityError');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('denied', 'SecurityError');
    });
    const store = new LayoutStore();
    await expect(store.load('live')).resolves.toBeNull();
    await expect(store.save('live', LIVE)).resolves.toBeUndefined();
  });
});

describe('LayoutStore — workspace backend tier', () => {
  it('prefers the workspace file over localStorage', async () => {
    const localOnly = new LayoutStore();
    await localOnly.save('live', { grid: { root: 'from-local' } });

    const backend = memoryBackend({
      [LAYOUT_FILE]: JSON.stringify({ version: 1, layouts: { live: LIVE } }),
    });
    const store = new LayoutStore(backend);
    expect(await store.load('live')).toEqual(LIVE);
  });

  it('writes to both tiers so the layout survives detaching the folder', async () => {
    const backend = memoryBackend();
    const store = new LayoutStore(backend);
    await store.save('live', LIVE);

    expect(JSON.parse(backend.files.get(LAYOUT_FILE)!).layouts.live).toEqual(LIVE);
    expect(JSON.parse(globalThis.localStorage.getItem(LAYOUT_STORAGE_KEY)!).layouts.live).toEqual(
      LIVE,
    );
  });

  it('falls back to localStorage when the workspace file is corrupt', async () => {
    const localStore = new LayoutStore();
    await localStore.save('live', LIVE);

    const backend = memoryBackend({ [LAYOUT_FILE]: '{{{ corrupt' });
    expect(await new LayoutStore(backend).load('live')).toEqual(LIVE);
  });

  it('falls back to localStorage when the workspace read throws', async () => {
    const localStore = new LayoutStore();
    await localStore.save('live', LIVE);

    const backend = memoryBackend();
    backend.exists = async () => true;
    backend.readText = async () => {
      throw new Error('permission revoked');
    };
    expect(await new LayoutStore(backend).load('live')).toEqual(LIVE);
  });

  it('does not lose the layout when the workspace write fails', async () => {
    const backend = memoryBackend();
    backend.writeText = async () => {
      throw new Error('disk full');
    };
    const store = new LayoutStore(backend);
    await expect(store.save('live', LIVE)).resolves.toBeUndefined();
    // localStorage still has it, so the arrangement survives a reload.
    expect(JSON.parse(globalThis.localStorage.getItem(LAYOUT_STORAGE_KEY)!).layouts.live).toEqual(
      LIVE,
    );
  });

  it('migrates an existing localStorage layout when a folder is first attached', async () => {
    const store = new LayoutStore();
    await store.save('live', LIVE);

    const backend = memoryBackend();
    await store.setBackend(backend);

    expect(backend.files.has(LAYOUT_FILE)).toBe(true);
    expect(JSON.parse(backend.files.get(LAYOUT_FILE)!).layouts.live).toEqual(LIVE);
  });

  it('does not clobber a workspace layout that already exists', async () => {
    const localStore = new LayoutStore();
    await localStore.save('live', { grid: { root: 'from-local' } });

    const backend = memoryBackend({
      [LAYOUT_FILE]: JSON.stringify({ version: 1, layouts: { live: LIVE } }),
    });
    await localStore.setBackend(backend);

    expect(JSON.parse(backend.files.get(LAYOUT_FILE)!).layouts.live).toEqual(LIVE);
  });

  it('migrates nothing when localStorage is empty', async () => {
    const backend = memoryBackend();
    await new LayoutStore().setBackend(backend);
    expect(backend.files.has(LAYOUT_FILE)).toBe(false);
  });

  it('can detach the backend and keep working against localStorage', async () => {
    const backend = memoryBackend();
    const store = new LayoutStore(backend);
    await store.save('live', LIVE);
    await store.setBackend(null);
    expect(await store.load('live')).toEqual(LIVE);
  });
});

describe('debounceLayoutSave', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('collapses a burst of changes into one write', () => {
    const save = vi.fn();
    const debounced = debounceLayoutSave(save, 500);

    // Simulates a drag: many onDidLayoutChange events in quick succession.
    for (let i = 0; i < 50; i += 1) {
      debounced.schedule({ grid: { root: `step-${i}` } });
      vi.advanceTimersByTime(10);
    }
    expect(save).not.toHaveBeenCalled();

    vi.advanceTimersByTime(500);
    expect(save).toHaveBeenCalledTimes(1);
    // The last state wins, not the first.
    expect(save).toHaveBeenCalledWith({ grid: { root: 'step-49' } });
  });

  it('writes after the delay for a single change', () => {
    const save = vi.fn();
    const debounced = debounceLayoutSave(save, 500);
    debounced.schedule(LIVE);
    vi.advanceTimersByTime(499);
    expect(save).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(save).toHaveBeenCalledWith(LIVE);
  });

  it('flush writes immediately and cancels the pending timer', () => {
    const save = vi.fn();
    const debounced = debounceLayoutSave(save, 500);
    debounced.schedule(LIVE);
    debounced.flush();
    expect(save).toHaveBeenCalledTimes(1);

    // The timer must not fire a second write afterwards.
    vi.advanceTimersByTime(1000);
    expect(save).toHaveBeenCalledTimes(1);
  });

  it('flush is a no-op with nothing pending', () => {
    const save = vi.fn();
    debounceLayoutSave(save, 500).flush();
    expect(save).not.toHaveBeenCalled();
  });

  it('cancel discards the pending write', () => {
    const save = vi.fn();
    const debounced = debounceLayoutSave(save, 500);
    debounced.schedule(LIVE);
    debounced.cancel();
    vi.advanceTimersByTime(1000);
    expect(save).not.toHaveBeenCalled();
  });

  it('starts a fresh cycle after a write has landed', () => {
    const save = vi.fn();
    const debounced = debounceLayoutSave(save, 500);
    debounced.schedule(LIVE);
    vi.advanceTimersByTime(500);
    debounced.schedule(EDIT);
    vi.advanceTimersByTime(500);
    expect(save).toHaveBeenCalledTimes(2);
    expect(save).toHaveBeenLastCalledWith(EDIT);
  });
});
