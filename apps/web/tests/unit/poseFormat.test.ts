/**
 * `WMOC` v1 format tests.
 *
 * The critical assertions here are the *byte-level* ones. The Rust reader is the
 * real consumer and it is not runnable from Vitest, so the only way to keep the
 * two in sync without a browser is to assert the exact bytes this writer produces
 * against the layout the Rust tests decode. If someone changes a field width on
 * either side, one of these fails.
 */

import { describe, expect, it } from 'vitest';

import {
  decodeTake,
  encodeFrame,
  encodeHeader,
  frameByteLength,
  TakeWriter,
  WMOC_HEADER_BYTES,
  WMOC_MAGIC,
  WMOC_VERSION,
} from '../../src/features/recording/TakeWriter';

const JOINTS = 17;

function sampleFrame(index: number, with3d: boolean) {
  const kp2d = new Float32Array(JOINTS * 2);
  for (let i = 0; i < kp2d.length; i += 1) kp2d[i] = index * 100 + i;
  const kp3d = with3d ? new Float32Array(JOINTS * 3) : null;
  if (kp3d) for (let i = 0; i < kp3d.length; i += 1) kp3d[i] = -(index * 10 + i) / 8;
  const conf = new Float32Array(JOINTS);
  for (let i = 0; i < conf.length; i += 1) conf[i] = (i % 8) / 8;
  return { t: index / 30, kp2d, kp3d, conf };
}

describe('header', () => {
  it('is exactly 18 bytes — the value the Rust reader asserts', () => {
    expect(WMOC_HEADER_BYTES).toBe(18);
    expect(encodeHeader(0, 17, 30).byteLength).toBe(18);
  });

  it('lays fields out at the documented offsets, little-endian', () => {
    const header = encodeHeader(300, 17, 30);
    const view = new DataView(header.buffer);
    expect(view.getUint32(0, true)).toBe(WMOC_MAGIC);
    expect(view.getUint16(4, true)).toBe(WMOC_VERSION);
    expect(view.getUint32(6, true)).toBe(300);
    expect(view.getUint32(10, true)).toBe(17);
    expect(view.getFloat32(14, true)).toBe(30);
  });

  it('spells WMOC when the magic is read as little-endian bytes', () => {
    const header = encodeHeader(0, 1, 1);
    // 0x574D4F43 little-endian => bytes 43 4F 4D 57 => "COMW".
    expect(Array.from(header.slice(0, 4))).toEqual([0x43, 0x4f, 0x4d, 0x57]);
  });
});

describe('frame encoding', () => {
  it('computes the documented frame size with 3D', () => {
    // 8 (t) + 34*4 (kp2d) + 1 (has3d) + 51*4 (kp3d) + 17*4 (conf)
    expect(frameByteLength(17, true)).toBe(8 + 136 + 1 + 204 + 68);
    expect(encodeFrame(sampleFrame(0, true), 17).byteLength).toBe(frameByteLength(17, true));
  });

  it('omits the 3D block entirely when there is no lift', () => {
    expect(frameByteLength(17, false)).toBe(8 + 136 + 1 + 68);
    const bytes = encodeFrame(sampleFrame(0, false), 17);
    expect(bytes.byteLength).toBe(frameByteLength(17, false));
    // The has3d flag sits right after the 2D block.
    expect(bytes[8 + 136]).toBe(0);
  });

  it('sets the has3d flag when 3D is present', () => {
    const bytes = encodeFrame(sampleFrame(0, true), 17);
    expect(bytes[8 + 136]).toBe(1);
  });

  it('writes the timestamp as f64 at offset 0', () => {
    const bytes = encodeFrame({ ...sampleFrame(0, false), t: 1234.5 }, 17);
    expect(new DataView(bytes.buffer).getFloat64(0, true)).toBe(1234.5);
  });

  it('rejects mis-sized keypoint arrays rather than writing garbage', () => {
    const frame = sampleFrame(0, true);
    expect(() => encodeFrame({ ...frame, kp2d: new Float32Array(10) }, 17)).toThrow(/kp2d/);
    expect(() => encodeFrame({ ...frame, conf: new Float32Array(3) }, 17)).toThrow(/conf/);
    expect(() => encodeFrame({ ...frame, kp3d: new Float32Array(4) }, 17)).toThrow(/kp3d/);
  });
});

describe('TakeWriter', () => {
  it('produces a header-only file when nothing was recorded', () => {
    const writer = new TakeWriter(JOINTS, 30);
    const bytes = writer.finish();
    expect(bytes.byteLength).toBe(WMOC_HEADER_BYTES);
    expect(decodeTake(bytes).frames).toHaveLength(0);
  });

  it('patches the frame count into the header on finish', () => {
    const writer = new TakeWriter(JOINTS, 30);
    for (let i = 0; i < 5; i += 1) writer.push(sampleFrame(i, true));
    const view = new DataView(writer.finish().buffer);
    expect(view.getUint32(6, true)).toBe(5);
  });

  it('reports the exact byte length it will emit', () => {
    const writer = new TakeWriter(JOINTS, 30);
    for (let i = 0; i < 3; i += 1) writer.push(sampleFrame(i, true));
    expect(writer.byteLength).toBe(WMOC_HEADER_BYTES + 3 * frameByteLength(JOINTS, true));
    expect(writer.finish().byteLength).toBe(writer.byteLength);
  });

  it('rejects a nonsensical joint count', () => {
    expect(() => new TakeWriter(0, 30)).toThrow(/positive integer/);
  });

  it('clears on reset', () => {
    const writer = new TakeWriter(JOINTS, 30);
    writer.push(sampleFrame(0, true));
    writer.reset();
    expect(writer.frameCount).toBe(0);
    expect(writer.byteLength).toBe(WMOC_HEADER_BYTES);
  });
});

describe('round trip', () => {
  it('preserves every field of every frame', () => {
    const writer = new TakeWriter(JOINTS, 29.97);
    const inputs = Array.from({ length: 12 }, (_, i) => sampleFrame(i, true));
    for (const frame of inputs) writer.push(frame);

    const take = decodeTake(writer.finish());
    expect(take.version).toBe(WMOC_VERSION);
    expect(take.jointCount).toBe(JOINTS);
    expect(take.fps).toBeCloseTo(29.97, 4);
    expect(take.frames).toHaveLength(12);

    take.frames.forEach((frame, i) => {
      const input = inputs[i]!;
      // t is f64, so it survives exactly.
      expect(frame.t).toBe(input.t);
      // Everything else is f32; the inputs were built from f32 arrays already, so
      // these must be bit-identical, not merely close.
      expect(Array.from(frame.kp2d)).toEqual(Array.from(input.kp2d));
      expect(Array.from(frame.kp3d!)).toEqual(Array.from(input.kp3d!));
      expect(Array.from(frame.conf)).toEqual(Array.from(input.conf));
    });
  });

  it('handles a mix of 2D-only and 3D frames in one take', () => {
    const writer = new TakeWriter(JOINTS, 30);
    writer.push(sampleFrame(0, true));
    writer.push(sampleFrame(1, false));
    writer.push(sampleFrame(2, true));

    const take = decodeTake(writer.finish());
    expect(take.frames.map((f) => f.kp3d !== null)).toEqual([true, false, true]);
    // The variable-length frames must not shear the ones after them.
    expect(take.frames[2]!.kp2d[0]).toBe(200);
  });

  it('round-trips a realistic 10-second take (the §17 acceptance shape)', () => {
    const writer = new TakeWriter(JOINTS, 30);
    for (let i = 0; i < 300; i += 1) writer.push(sampleFrame(i, true));
    const bytes = writer.finish();

    const take = decodeTake(bytes);
    expect(take.frames).toHaveLength(300);
    expect(take.frames[299]!.t).toBeCloseTo(299 / 30, 9);
    // Timestamps must be strictly increasing, or downstream filtering breaks.
    for (let i = 1; i < take.frames.length; i += 1) {
      expect(take.frames[i]!.t).toBeGreaterThan(take.frames[i - 1]!.t);
    }
  });

  it('survives extreme but legal float values', () => {
    const kp2d = new Float32Array(JOINTS * 2).fill(0);
    kp2d[0] = 0;
    kp2d[1] = -0;
    kp2d[2] = 3.4028234663852886e38;
    kp2d[3] = -3.4028234663852886e38;
    kp2d[4] = 1.401298464324817e-45;
    const conf = new Float32Array(JOINTS).fill(1);

    const writer = new TakeWriter(JOINTS, 30);
    writer.push({ t: 0, kp2d, kp3d: null, conf });
    const decoded = decodeTake(writer.finish()).frames[0]!;
    expect(decoded.kp2d[2]).toBe(3.4028234663852886e38);
    expect(decoded.kp2d[3]).toBe(-3.4028234663852886e38);
    expect(Object.is(decoded.kp2d[1], -0)).toBe(true);
  });

  it('round-trips NaN confidences without turning them into zeros', () => {
    const conf = new Float32Array(JOINTS).fill(0.5);
    conf[0] = NaN;
    const writer = new TakeWriter(JOINTS, 30);
    writer.push({ t: 0, kp2d: new Float32Array(JOINTS * 2), kp3d: null, conf });
    expect(Number.isNaN(decodeTake(writer.finish()).frames[0]!.conf[0])).toBe(true);
  });
});

describe('decoder rejects malformed input', () => {
  it('rejects a file shorter than the header', () => {
    expect(() => decodeTake(new Uint8Array(4))).toThrow(/shorter than the header/);
  });

  it('rejects a bad magic', () => {
    const bytes = encodeHeader(0, 17, 30);
    bytes[0] = 0;
    expect(() => decodeTake(bytes)).toThrow(/bad magic/);
  });

  it('rejects an unknown version', () => {
    const bytes = encodeHeader(0, 17, 30);
    new DataView(bytes.buffer).setUint16(4, 99, true);
    expect(() => decodeTake(bytes)).toThrow(/unsupported version/);
  });

  it('rejects a truncated frame rather than returning short data', () => {
    const writer = new TakeWriter(JOINTS, 30);
    writer.push(sampleFrame(0, true));
    writer.push(sampleFrame(1, true));
    const full = writer.finish();
    expect(() => decodeTake(full.slice(0, full.byteLength - 20))).toThrow(/truncated/);
  });

  it('rejects a header claiming more frames than are present', () => {
    const writer = new TakeWriter(JOINTS, 30);
    writer.push(sampleFrame(0, true));
    const bytes = writer.finish();
    new DataView(bytes.buffer).setUint32(6, 50, true);
    expect(() => decodeTake(bytes)).toThrow(/truncated/);
  });

  it('decodes a view into a larger buffer at a non-zero offset', () => {
    const writer = new TakeWriter(JOINTS, 30);
    writer.push(sampleFrame(7, true));
    const payload = writer.finish();

    // Simulates reading out of a ring buffer or a concatenated file.
    const padded = new Uint8Array(payload.byteLength + 64);
    padded.set(payload, 32);
    const view = padded.subarray(32, 32 + payload.byteLength);

    expect(decodeTake(view).frames[0]!.kp2d[0]).toBe(700);
  });
});
