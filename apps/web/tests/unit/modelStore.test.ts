/**
 * User-installed model storage (Document 3 §C).
 *
 * Runs against the in-memory OPFS used elsewhere in the suite, so the directory
 * handling and the checksum guarantee are genuinely exercised rather than mocked.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  ModelInstallError,
  installModel,
  listInstalledModels,
  readInstalledModel,
  removeInstalledModel,
} from '../../src/features/capture/modelStore';
import { MemoryDirectoryHandle } from './memoryFileSystem';

/** Bytes that pass the ONNX sniff: protobuf field 1 (ir_version). */
function onnxBytes(extra = 32): Uint8Array {
  const bytes = new Uint8Array(8 + extra);
  bytes[0] = 0x08;
  bytes[1] = 0x09;
  for (let i = 8; i < bytes.length; i += 1) bytes[i] = i & 0xff;
  return bytes;
}

function asFile(bytes: Uint8Array, name: string): File {
  return new File([bytes.buffer as ArrayBuffer], name, { type: 'application/octet-stream' });
}

let root: MemoryDirectoryHandle;

beforeEach(() => {
  root = new MemoryDirectoryHandle('opfs');
  vi.stubGlobal('navigator', {
    storage: { getDirectory: async () => root, estimate: async () => ({ usage: 0 }) },
  });
});

describe('installModel', () => {
  it('stores a valid onnx file and records its checksum', async () => {
    const record = await installModel(asFile(onnxBytes(), 'movenet.onnx'));

    expect(record.name).toBe('movenet.onnx');
    expect(record.sizeBytes).toBe(40);
    expect(record.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(await listInstalledModels()).toHaveLength(1);
  });

  it('rejects a file that is not .onnx', async () => {
    await expect(installModel(asFile(onnxBytes(), 'weights.bin'))).rejects.toBeInstanceOf(
      ModelInstallError,
    );
  });

  it('rejects a Git LFS pointer masquerading as a model', async () => {
    // A very common failure: raw.githubusercontent serves a text pointer, not
    // the binary. Catching it here beats an opaque error inside the runtime.
    const pointer = new TextEncoder().encode(
      'version https://git-lfs.github.com/spec/v1\noid sha256:abc\nsize 9408464\n',
    );
    await expect(installModel(asFile(pointer, 'movenet.onnx'))).rejects.toThrow(/LFS/);
  });

  it('rejects an HTML error page saved with the wrong name', async () => {
    const html = new TextEncoder().encode('<!DOCTYPE html><html><body>404</body></html>');
    await expect(installModel(asFile(html, 'model.onnx'))).rejects.toThrow(/ONNX model/);
  });

  it('replaces rather than duplicating when the same name is reinstalled', async () => {
    await installModel(asFile(onnxBytes(16), 'movenet.onnx'));
    await installModel(asFile(onnxBytes(64), 'movenet.onnx'));

    const models = await listInstalledModels();
    expect(models).toHaveLength(1);
    expect(models[0]!.sizeBytes).toBe(72);
  });

  it('keeps several differently-named models', async () => {
    await installModel(asFile(onnxBytes(), 'a.onnx'));
    await installModel(asFile(onnxBytes(), 'b.onnx'));
    expect((await listInstalledModels()).map((m) => m.name).sort()).toEqual(['a.onnx', 'b.onnx']);
  });
});

describe('readInstalledModel', () => {
  it('round-trips the exact bytes', async () => {
    const bytes = onnxBytes();
    await installModel(asFile(bytes, 'movenet.onnx'));

    expect(Array.from(await readInstalledModel('movenet.onnx'))).toEqual(Array.from(bytes));
  });

  it('refuses a model that changed on disk', async () => {
    await installModel(asFile(onnxBytes(), 'movenet.onnx'));

    // Corrupt the stored file behind the index's back.
    const dir = await root.getDirectoryHandle('models');
    const handle = await dir.getFileHandle('movenet.onnx');
    const writable = await handle.createWritable();
    await writable.write(onnxBytes(99).buffer as ArrayBuffer);
    await writable.close();

    // This file is about to drive every recording the user makes; loading it
    // silently after it changed would be the wrong failure mode.
    await expect(readInstalledModel('movenet.onnx')).rejects.toThrow(/checksum/);
  });

  it('reports a clear error for a model that is not installed', async () => {
    await expect(readInstalledModel('nope.onnx')).rejects.toThrow(/not installed/);
  });
});

describe('removeInstalledModel', () => {
  it('removes the file and the index entry', async () => {
    await installModel(asFile(onnxBytes(), 'movenet.onnx'));
    await removeInstalledModel('movenet.onnx');

    expect(await listInstalledModels()).toEqual([]);
    await expect(readInstalledModel('movenet.onnx')).rejects.toThrow();
  });

  it('is safe to call for something that is not there', async () => {
    await expect(removeInstalledModel('ghost.onnx')).resolves.toBeUndefined();
  });
});

describe('without OPFS', () => {
  it('reports no installed models rather than throwing', async () => {
    vi.stubGlobal('navigator', {});
    // A browser with no private file system should degrade, not crash the panel.
    await expect(listInstalledModels()).resolves.toEqual([]);
  });
});
