/**
 * Writer for the `WMOC` v1 binary pose format. The reader lives in Rust
 * (`crates/mocap-core/src/pose_format.rs`) and the two are pinned together by a
 * parity test.
 *
 * # Why the writer is TypeScript
 *
 * This inverts the project's usual "numerics in Rust" rule, deliberately. The
 * recorder already holds each pose as JS objects on the JS side; shipping every
 * frame across the WASM boundary purely so Rust can memcpy it into a buffer costs
 * more than the serialisation itself. Reading, by contrast, happens once per take
 * and feeds the Rust retarget/export path, so it belongs there. This exemption is
 * recorded in docs/decisions.md.
 *
 * # Layout (little-endian throughout, header exactly 18 bytes)
 *
 * ```
 * header:  u32 magic (0x574D4F43)
 *          u16 version (1)
 *          u32 frameCount
 *          u32 jointCount
 *          f32 fps
 * frame:   f64  t
 *          f32  kp2d[J * 2]
 *          u8   has3d
 *          f32  kp3d[J * 3]     // present only when has3d == 1
 *          f32  conf[J]
 * ```
 *
 * Nothing is padded or aligned. Both sides compute every offset explicitly, so
 * there is no struct layout for them to disagree about — which is the whole
 * reason the header is an awkward 18 bytes rather than a tidy 20.
 *
 * `frameCount` is not known until recording stops, so it is written as 0 up front
 * and patched in `finish()`. Streaming callers must therefore either buffer or be
 * able to rewrite the first 18 bytes; `TakeWriter` buffers, and the streaming
 * variant below patches the header as a separate final write.
 */

export const WMOC_MAGIC = 0x574d_4f43;
export const WMOC_VERSION = 1;
export const WMOC_HEADER_BYTES = 18;

export interface PoseFrameInput {
  /** Presentation time in seconds, from the master clock. */
  t: number;
  /** `jointCount * 2` image-space coordinates. */
  kp2d: ArrayLike<number>;
  /** `jointCount * 3` world coordinates, or null when no lift ran. */
  kp3d?: ArrayLike<number> | null;
  /** `jointCount` confidences in [0, 1]. */
  conf: ArrayLike<number>;
}

/** Bytes one frame occupies, given the joint count and whether it carries 3D. */
export function frameByteLength(jointCount: number, has3d: boolean): number {
  return 8 + jointCount * 2 * 4 + 1 + (has3d ? jointCount * 3 * 4 : 0) + jointCount * 4;
}

/** Serialises the 18-byte header. */
export function encodeHeader(frameCount: number, jointCount: number, fps: number): Uint8Array {
  const buffer = new ArrayBuffer(WMOC_HEADER_BYTES);
  const view = new DataView(buffer);
  view.setUint32(0, WMOC_MAGIC, true);
  view.setUint16(4, WMOC_VERSION, true);
  view.setUint32(6, frameCount, true);
  view.setUint32(10, jointCount, true);
  view.setFloat32(14, fps, true);
  return new Uint8Array(buffer);
}

/**
 * Accumulates frames in memory and emits the complete file.
 *
 * Suitable for takes of the length this phase targets: at 17 joints a frame is
 * ~230 bytes, so ten minutes at 30fps is ~4 MB. Long-form recording would want
 * the streaming writer instead.
 */
export class TakeWriter {
  private readonly chunks: Uint8Array[] = [];
  private frames = 0;

  constructor(
    readonly jointCount: number,
    readonly fps: number,
  ) {
    if (!Number.isInteger(jointCount) || jointCount <= 0) {
      throw new RangeError(`TakeWriter: jointCount must be a positive integer`);
    }
  }

  get frameCount(): number {
    return this.frames;
  }

  /** Bytes the finished file will occupy. */
  get byteLength(): number {
    return WMOC_HEADER_BYTES + this.chunks.reduce((n, c) => n + c.byteLength, 0);
  }

  push(frame: PoseFrameInput): void {
    this.chunks.push(encodeFrame(frame, this.jointCount));
    this.frames += 1;
  }

  /** Produces the complete file, header included. */
  finish(): Uint8Array {
    const out = new Uint8Array(this.byteLength);
    out.set(encodeHeader(this.frames, this.jointCount, this.fps), 0);
    let offset = WMOC_HEADER_BYTES;
    for (const chunk of this.chunks) {
      out.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return out;
  }

  reset(): void {
    this.chunks.length = 0;
    this.frames = 0;
  }
}

/** Encodes one frame. Exported for the parity test. */
export function encodeFrame(frame: PoseFrameInput, jointCount: number): Uint8Array {
  const kp2d = frame.kp2d;
  const conf = frame.conf;
  const kp3d = frame.kp3d ?? null;

  if (kp2d.length !== jointCount * 2) {
    throw new RangeError(`encodeFrame: kp2d must hold ${jointCount * 2}, got ${kp2d.length}`);
  }
  if (conf.length !== jointCount) {
    throw new RangeError(`encodeFrame: conf must hold ${jointCount}, got ${conf.length}`);
  }
  if (kp3d && kp3d.length !== jointCount * 3) {
    throw new RangeError(`encodeFrame: kp3d must hold ${jointCount * 3}, got ${kp3d.length}`);
  }

  const has3d = kp3d !== null;
  const buffer = new ArrayBuffer(frameByteLength(jointCount, has3d));
  const view = new DataView(buffer);
  let offset = 0;

  view.setFloat64(offset, frame.t, true);
  offset += 8;

  for (let i = 0; i < jointCount * 2; i += 1) {
    view.setFloat32(offset, kp2d[i]!, true);
    offset += 4;
  }

  view.setUint8(offset, has3d ? 1 : 0);
  offset += 1;

  if (kp3d) {
    for (let i = 0; i < jointCount * 3; i += 1) {
      view.setFloat32(offset, kp3d[i]!, true);
      offset += 4;
    }
  }

  for (let i = 0; i < jointCount; i += 1) {
    view.setFloat32(offset, conf[i]!, true);
    offset += 4;
  }

  return new Uint8Array(buffer);
}

/**
 * A minimal `WMOC` reader in TypeScript.
 *
 * The *authoritative* reader is the Rust one; this exists so the app can validate
 * and round-trip a take without the WASM module loaded, and so the parity test can
 * assert that TS-write -> TS-read and TS-write -> Rust-read agree.
 */
export interface DecodedTake {
  version: number;
  fps: number;
  jointCount: number;
  frames: {
    t: number;
    kp2d: Float32Array;
    kp3d: Float32Array | null;
    conf: Float32Array;
  }[];
}

export function decodeTake(bytes: Uint8Array): DecodedTake {
  if (bytes.byteLength < WMOC_HEADER_BYTES) {
    throw new Error(`WMOC: file is ${bytes.byteLength} bytes, shorter than the header`);
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const magic = view.getUint32(0, true);
  if (magic !== WMOC_MAGIC) {
    throw new Error(`WMOC: bad magic 0x${magic.toString(16)}`);
  }
  const version = view.getUint16(4, true);
  if (version !== WMOC_VERSION) {
    throw new Error(`WMOC: unsupported version ${version}`);
  }
  const frameCount = view.getUint32(6, true);
  const jointCount = view.getUint32(10, true);
  const fps = view.getFloat32(14, true);

  const frames: DecodedTake['frames'] = [];
  let offset = WMOC_HEADER_BYTES;

  /** Bounds-check before every read, so a short file reports which frame failed. */
  const need = (count: number, frame: number) => {
    if (offset + count > bytes.byteLength) {
      throw new Error(
        `WMOC: truncated at frame ${frame} — needed ${count} more bytes at offset ${offset}, ` +
          `file is ${bytes.byteLength}`,
      );
    }
  };

  for (let f = 0; f < frameCount; f += 1) {
    need(8, f);
    const t = view.getFloat64(offset, true);
    offset += 8;

    need(jointCount * 2 * 4, f);
    const kp2d = new Float32Array(jointCount * 2);
    for (let i = 0; i < kp2d.length; i += 1) {
      kp2d[i] = view.getFloat32(offset, true);
      offset += 4;
    }

    need(1, f);
    const has3d = view.getUint8(offset) === 1;
    offset += 1;

    let kp3d: Float32Array | null = null;
    if (has3d) {
      need(jointCount * 3 * 4, f);
      kp3d = new Float32Array(jointCount * 3);
      for (let i = 0; i < kp3d.length; i += 1) {
        kp3d[i] = view.getFloat32(offset, true);
        offset += 4;
      }
    }

    need(jointCount * 4, f);
    const conf = new Float32Array(jointCount);
    for (let i = 0; i < conf.length; i += 1) {
      conf[i] = view.getFloat32(offset, true);
      offset += 4;
    }

    frames.push({ t, kp2d, kp3d, conf });
  }

  return { version, fps, jointCount, frames };
}
