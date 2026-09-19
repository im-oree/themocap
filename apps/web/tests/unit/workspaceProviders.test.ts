/**
 * Storage-tier conformance suite (§17: "all three storage tiers working + tested").
 *
 * The bulk of this file is a single contract suite run three times, once per
 * provider. That is deliberate: the point of the `WorkspaceProvider` abstraction
 * is that the recorder cannot tell which tier it is talking to, and the only way
 * to keep that true is to assert identical behaviour across all three.
 * Tier-specific behaviour gets its own describe block at the bottom.
 */

import 'fake-indexeddb/auto';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { FsaWorkspaceProvider } from '../../src/features/workspace/providers/fsaProvider';
import { IdbWorkspaceProvider } from '../../src/features/workspace/providers/idbProvider';
import { OpfsWorkspaceProvider } from '../../src/features/workspace/providers/opfsProvider';
import {
  createProvider,
  describeSelection,
  detectWorkspaceCapabilities,
  PROVIDER_PRIORITY,
  selectProvider,
} from '../../src/features/workspace/selectProvider';
import {
  normalizePath,
  splitPath,
  WorkspaceError,
  type WorkspaceProvider,
} from '../../src/features/workspace/types';
import { MemoryDirectoryHandle } from './memoryFileSystem';

const text = (s: string) => new TextEncoder().encode(s);
const decode = (b: Uint8Array) => new TextDecoder().decode(b);

interface Harness {
  name: string;
  make: () => Promise<WorkspaceProvider>;
}

const harnesses: Harness[] = [
  {
    name: 'fsa',
    make: async () => {
      const root = new MemoryDirectoryHandle('picked-folder');
      const provider = new FsaWorkspaceProvider(root as never);
      return provider;
    },
  },
  {
    name: 'opfs',
    make: async () => {
      const root = new MemoryDirectoryHandle('opfs-root');
      vi.stubGlobal('navigator', {
        ...globalThis.navigator,
        storage: {
          getDirectory: async () => root,
          estimate: async () => ({ usage: 4096, quota: 1_000_000 }),
        },
      });
      const provider = new OpfsWorkspaceProvider();
      await provider.requestAccess();
      return provider;
    },
  },
  {
    name: 'idb-fallback',
    make: async () => {
      const provider = new IdbWorkspaceProvider();
      await provider.requestAccess();
      await provider.clear();
      return provider;
    },
  },
];

describe.each(harnesses)('WorkspaceProvider contract — $name', ({ make }) => {
  let provider: WorkspaceProvider;

  beforeEach(async () => {
    provider = await make();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('is ready once access has been granted', () => {
    expect(provider.isReady()).toBe(true);
  });

  it('round-trips text', async () => {
    await provider.writeText('notes.txt', 'hello mocap');
    expect(await provider.readText('notes.txt')).toBe('hello mocap');
  });

  it('round-trips binary data byte-for-byte', async () => {
    const bytes = new Uint8Array([0, 1, 127, 128, 255, 42]);
    await provider.writeFile('data.bin', bytes);
    expect(Array.from(await provider.readFile('data.bin'))).toEqual(Array.from(bytes));
  });

  it('creates intermediate directories implicitly on write', async () => {
    await provider.writeText('projects/demo/takes/t1/take.json', '{}');
    expect(await provider.exists('projects/demo/takes/t1/take.json')).toBe(true);
  });

  it('mkdirp creates a directory that lists as empty', async () => {
    await provider.mkdirp('projects/empty');
    expect(await provider.list('projects/empty')).toEqual([]);
  });

  it('overwrites an existing file rather than appending', async () => {
    await provider.writeText('a.txt', 'first-and-longer');
    await provider.writeText('a.txt', 'second');
    expect(await provider.readText('a.txt')).toBe('second');
  });

  it('reports existence accurately', async () => {
    expect(await provider.exists('nope.txt')).toBe(false);
    await provider.writeText('yes.txt', 'x');
    expect(await provider.exists('yes.txt')).toBe(true);
  });

  it('throws not-found when reading a missing file', async () => {
    await expect(provider.readFile('missing.bin')).rejects.toThrow(WorkspaceError);
    await expect(provider.readText('missing.txt')).rejects.toMatchObject({ code: 'not-found' });
  });

  it('lists immediate children only, with kinds', async () => {
    await provider.writeText('projects/a/project.json', '{}');
    await provider.writeText('projects/b/project.json', '{}');
    await provider.writeText('projects/loose.txt', 'x');

    const entries = await provider.list('projects');
    expect(entries).toEqual([
      { name: 'a', kind: 'directory' },
      { name: 'b', kind: 'directory' },
      { name: 'loose.txt', kind: 'file' },
    ]);
  });

  it('lists the root', async () => {
    await provider.writeText('workspace.json', '{}');
    await provider.mkdirp('projects');
    const names = (await provider.list('')).map((e) => e.name);
    expect(names).toContain('workspace.json');
    expect(names).toContain('projects');
  });

  it('removes a file', async () => {
    await provider.writeText('doomed.txt', 'x');
    await provider.remove('doomed.txt');
    expect(await provider.exists('doomed.txt')).toBe(false);
  });

  it('removes a directory and its contents', async () => {
    await provider.writeText('projects/gone/takes/t1/take.json', '{}');
    await provider.remove('projects/gone');
    expect(await provider.exists('projects/gone')).toBe(false);
    expect(await provider.exists('projects/gone/takes/t1/take.json')).toBe(false);
  });

  it('streams a file through createWriter in several chunks', async () => {
    const writer = await provider.createWriter('stream.bin');
    await writer.write(text('chunk-one|'));
    await writer.write(text('chunk-two|'));
    await writer.write(text('chunk-three'));
    await writer.close();

    expect(decode(await provider.readFile('stream.bin'))).toBe(
      'chunk-one|chunk-two|chunk-three',
    );
  });

  it('accepts Blob chunks as well as bytes (MediaRecorder emits Blobs)', async () => {
    const writer = await provider.createWriter('video.webm');
    await writer.write(new Blob([text('AAA')]));
    await writer.write(new Blob([text('BBB')]));
    await writer.close();
    expect(decode(await provider.readFile('video.webm'))).toBe('AAABBB');
  });

  it('rejects writes after close', async () => {
    const writer = await provider.createWriter('closed.bin');
    await writer.write(text('x'));
    await writer.close();
    await expect(writer.write(text('y'))).rejects.toThrow(/closed/);
  });

  it('tolerates a double close', async () => {
    const writer = await provider.createWriter('dbl.bin');
    await writer.write(text('x'));
    await writer.close();
    await expect(writer.close()).resolves.toBeUndefined();
  });

  it('supports abort for a cancelled recording', async () => {
    const writer = await provider.createWriter('cancelled.bin');
    await writer.write(text('partial'));
    await writer.abort();
    // Either the file never materialised or it is empty — both mean "no take".
    const exists = await provider.exists('cancelled.bin');
    if (exists) {
      expect((await provider.readFile('cancelled.bin')).byteLength).toBe(0);
    }
  });

  it('handles a large payload without corrupting it', async () => {
    const big = new Uint8Array(256 * 1024);
    for (let i = 0; i < big.length; i += 1) big[i] = i % 251;
    await provider.writeFile('big.bin', big);
    const read = await provider.readFile('big.bin');
    expect(read.byteLength).toBe(big.byteLength);
    expect(read[0]).toBe(0);
    expect(read[1000]).toBe(1000 % 251);
    expect(read[big.length - 1]).toBe((big.length - 1) % 251);
  });

  it('accepts a view backed by SharedArrayBuffer', async () => {
    // Pose data arrives straight out of a ring buffer, so this is the real case.
    const shared = new Uint8Array(new SharedArrayBuffer(8));
    shared.set([1, 2, 3, 4, 5, 6, 7, 8]);
    await provider.writeFile('shared.bin', shared.subarray(2, 6));
    expect(Array.from(await provider.readFile('shared.bin'))).toEqual([3, 4, 5, 6]);
  });

  it('refuses paths that escape the workspace root', async () => {
    await expect(provider.writeText('../escape.txt', 'x')).rejects.toMatchObject({
      code: 'invalid-path',
    });
    await expect(provider.readText('projects/../../etc/passwd')).rejects.toMatchObject({
      code: 'invalid-path',
    });
  });

  it('reports usage as a number or null, never NaN', async () => {
    const usage = await provider.usage();
    expect(usage === null || Number.isFinite(usage)).toBe(true);
  });
});

describe('path handling', () => {
  it('strips redundant separators and dot segments', () => {
    expect(normalizePath('/a//b/./c')).toEqual(['a', 'b', 'c']);
  });

  it('rejects traversal, null bytes, and empty paths', () => {
    expect(() => normalizePath('a/../b')).toThrow(/escapes/);
    expect(() => normalizePath('a/\0b')).toThrow(/null byte/);
    expect(() => normalizePath('///')).toThrow(/Empty path/);
  });

  it('splits a path into directory and name', () => {
    expect(splitPath('projects/demo/take.json')).toEqual({
      dir: ['projects', 'demo'],
      name: 'take.json',
    });
    expect(splitPath('top.txt')).toEqual({ dir: [], name: 'top.txt' });
  });
});

describe('tier-specific behaviour', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('fsa reports not-ready before a folder is chosen', async () => {
    const provider = new FsaWorkspaceProvider();
    expect(provider.isReady()).toBe(false);
    expect(provider.label).toMatch(/not chosen/);
    await expect(provider.writeText('a.txt', 'x')).rejects.toMatchObject({ code: 'not-ready' });
  });

  it('fsa labels itself with the chosen folder name', () => {
    const provider = new FsaWorkspaceProvider(new MemoryDirectoryHandle('MoCap') as never);
    expect(provider.label).toBe('Folder: MoCap');
  });

  it('fsa surfaces a denied permission on a restored handle', async () => {
    const root = new MemoryDirectoryHandle('restored');
    root.permission = 'denied';
    const provider = new FsaWorkspaceProvider(root as never);
    await expect(provider.ensurePermission()).rejects.toMatchObject({ code: 'denied' });
  });

  it('fsa turns a cancelled picker into a denied error rather than hanging', async () => {
    vi.stubGlobal('window', {
      showDirectoryPicker: async () => {
        throw new DOMException('user aborted', 'AbortError');
      },
    });
    const provider = new FsaWorkspaceProvider();
    await expect(provider.requestAccess()).rejects.toMatchObject({ code: 'denied' });
  });

  it('fsa reports unsupported when the API is absent', async () => {
    vi.stubGlobal('window', {});
    await expect(new FsaWorkspaceProvider().requestAccess()).rejects.toMatchObject({
      code: 'unsupported',
    });
  });

  it('fsa reports unknown usage, since a user folder has no quota API', async () => {
    const provider = new FsaWorkspaceProvider(new MemoryDirectoryHandle() as never);
    expect(await provider.usage()).toBeNull();
  });

  it('opfs reports unsupported when getDirectory is missing', async () => {
    vi.stubGlobal('navigator', { storage: {} });
    await expect(new OpfsWorkspaceProvider().requestAccess()).rejects.toMatchObject({
      code: 'unsupported',
    });
  });

  it('opfs reports usage from the storage estimate', async () => {
    vi.stubGlobal('navigator', {
      storage: {
        getDirectory: async () => new MemoryDirectoryHandle(),
        estimate: async () => ({ usage: 12345 }),
      },
    });
    const provider = new OpfsWorkspaceProvider();
    await provider.requestAccess();
    expect(await provider.usage()).toBe(12345);
  });

  it('idb synthesises directories for paths written without mkdirp', async () => {
    const provider = new IdbWorkspaceProvider();
    await provider.requestAccess();
    await provider.clear();
    await provider.writeText('deep/a/b/c.txt', 'x');
    expect(await provider.list('deep')).toEqual([{ name: 'a', kind: 'directory' }]);
    expect(await provider.list('deep/a/b')).toEqual([{ name: 'c.txt', kind: 'file' }]);
  });

  it('idb keeps nothing after an aborted writer', async () => {
    const provider = new IdbWorkspaceProvider();
    await provider.requestAccess();
    await provider.clear();
    const writer = await provider.createWriter('take.bin');
    await writer.write(text('buffered'));
    await writer.abort();
    expect(await provider.exists('take.bin')).toBe(false);
  });
});

describe('capability detection and selection', () => {
  afterEach(() => vi.unstubAllGlobals());

  function stubSupport(opts: { fsa: boolean; opfs: boolean }) {
    vi.stubGlobal(
      'window',
      opts.fsa ? { showDirectoryPicker: async () => new MemoryDirectoryHandle() } : {},
    );
    vi.stubGlobal(
      'navigator',
      opts.opfs ? { storage: { getDirectory: async () => new MemoryDirectoryHandle() } } : {},
    );
  }

  it('prefers fsa when everything is available', () => {
    stubSupport({ fsa: true, opfs: true });
    const caps = detectWorkspaceCapabilities();
    expect(caps.preferred).toBe('fsa');
    expect(caps.available).toEqual(['fsa', 'opfs', 'idb-fallback']);
    expect(caps.requiresUserGesture).toBe(true);
  });

  it('falls back to opfs in a browser without the picker', () => {
    stubSupport({ fsa: false, opfs: true });
    const caps = detectWorkspaceCapabilities();
    expect(caps.preferred).toBe('opfs');
    expect(caps.available).not.toContain('fsa');
    expect(caps.requiresUserGesture).toBe(false);
  });

  it('falls back to indexeddb when neither filesystem API exists', () => {
    stubSupport({ fsa: false, opfs: false });
    expect(detectWorkspaceCapabilities().preferred).toBe('idb-fallback');
  });

  it('honours a supported user override', () => {
    stubSupport({ fsa: true, opfs: true });
    const selection = selectProvider('opfs');
    expect(selection.id).toBe('opfs');
    expect(selection.reason).toBe('user-override');
    expect(describeSelection(selection)).toMatch(/your choice/i);
  });

  it('falls back and explains when the override is unsupported', () => {
    stubSupport({ fsa: false, opfs: true });
    const selection = selectProvider('fsa');
    expect(selection.id).toBe('opfs');
    expect(selection.reason).toBe('override-unavailable');
    expect(describeSelection(selection)).toMatch(/not supported in this browser/i);
  });

  it('auto-selects with no override', () => {
    stubSupport({ fsa: true, opfs: true });
    const selection = selectProvider(null);
    expect(selection.id).toBe('fsa');
    expect(selection.reason).toBe('auto');
  });

  it('constructs each provider by id', () => {
    for (const id of PROVIDER_PRIORITY) {
      expect(createProvider(id).id).toBe(id);
    }
  });
});
