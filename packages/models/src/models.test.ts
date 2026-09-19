import { describe, expect, it } from 'vitest';
import manifestJson from '../manifest.json';
import { sha256Hex, verifySha256, ChecksumMismatchError } from './checksum';
import { assertSameOrigin } from './downloadManager';
import { ManifestValidationError, validateManifest, modelsByStage } from './types';

const EMPTY_SHA = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';
const ABC_SHA = 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad';

describe('sha256 helpers', () => {
  it('matches known vectors', async () => {
    await expect(sha256Hex(new Uint8Array())).resolves.toBe(EMPTY_SHA);
    await expect(sha256Hex(new TextEncoder().encode('abc'))).resolves.toBe(ABC_SHA);
  });

  it('accepts a matching checksum and rejects a mismatch', async () => {
    const data = new TextEncoder().encode('abc');
    await expect(verifySha256(data, ABC_SHA.toUpperCase(), 'abc')).resolves.toBeUndefined();
    await expect(verifySha256(data, EMPTY_SHA, 'abc')).rejects.toBeInstanceOf(
      ChecksumMismatchError,
    );
  });

  it('rejects malformed expectations rather than silently passing', async () => {
    await expect(verifySha256(new Uint8Array(), 'not-a-hash')).rejects.toThrow(/Invalid expected/);
  });
});

describe('download manager guards', () => {
  it('refuses absolute remote URLs', () => {
    expect(() => assertSameOrigin('https://cdn.example.com/m.onnx')).toThrow(/same-origin/);
    expect(() => assertSameOrigin('/models/rtmpose-tiny-fp16.onnx')).not.toThrow();
  });
});

describe('model manifest', () => {
  const manifest = validateManifest(manifestJson);

  it('validates against the schema', () => {
    expect(manifest.schemaVersion).toBe(1);
    expect(manifest.models.length).toBeGreaterThan(0);
  });

  it('covers every Document 1 benchmark task', () => {
    const tasks = new Set(manifest.models.map((m) => m.task));
    expect(tasks).toContain('person-detector');
    expect(tasks).toContain('pose-2d');
    expect(tasks).toContain('lift-3d');
    expect(tasks).toContain('depth');
  });

  it('exposes bench candidates for the harness dropdown', () => {
    expect(modelsByStage(manifest, 'bench-candidate').length).toBeGreaterThan(0);
  });

  it('never points at a remote URL and always has a verified license', () => {
    for (const m of manifest.models) {
      expect(m.file.startsWith('/models/')).toBe(true);
      expect(m.provenance.licenseVerified).toBe(true);
      expect(m.provenance.license).not.toMatch(/NC|non-commercial/i);
    }
  });

  it('rejects unverified licenses', () => {
    const bad = {
      ...manifest,
      models: [
        {
          ...manifest.models[0]!,
          provenance: { ...manifest.models[0]!.provenance, licenseVerified: false },
        },
      ],
    };
    expect(() => validateManifest(bad)).toThrow(ManifestValidationError);
  });

  it('rejects duplicate ids and remote files', () => {
    const first = manifest.models[0]!;
    expect(() => validateManifest({ ...manifest, models: [first, first] })).toThrow(/duplicate/);
    expect(() =>
      validateManifest({
        ...manifest,
        models: [{ ...first, file: 'https://cdn.example.com/x.onnx' }],
      }),
    ).toThrow(/same-origin/);
  });

  it('requires a checksum once a model is marked acquired', () => {
    const first = manifest.models[0]!;
    expect(() => validateManifest({ ...manifest, models: [{ ...first, acquired: true }] })).toThrow(
      /sha256/,
    );
  });
});
