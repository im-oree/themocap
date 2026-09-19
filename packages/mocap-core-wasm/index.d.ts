/**
 * Hand-written types mirroring crates/mocap-core's `#[wasm_bindgen]` surface.
 *
 * wasm-pack also emits `pkg/mocap_core.d.ts`, but `pkg/` is generated and
 * git-ignored, so typechecking a fresh clone (or CI before the wasm step) must not
 * depend on it. Keep this file in sync with src/lib.rs — the Rust tests and the
 * Vitest bridge test will catch any drift in behaviour.
 */

/** 1D One Euro filter (Casiez et al., 2012). */
export class OneEuroFilter {
  constructor(min_cutoff: number, beta: number, d_cutoff: number);
  /** Filter sample `x` at timestamp `t` (seconds); returns the smoothed value. */
  filter(x: number, t: number): number;
  /** Drop history so the next sample is treated as the first. */
  reset(): void;
  free(): void;
}

/** Sanity function proving the JS <-> WASM numeric round trip. `ping(21) === 42`. */
export function ping(x: number): number;

/** Version of the Rust crate, surfaced in the diagnostics panel. */
export function core_version(): string;

/**
 * One Euro filter fanned out over every channel of a pose, so a whole frame is
 * smoothed in one call under shared parameters.
 *
 * Channel layout is the caller's business: for 21 joints x (x, y, z) pass 63.
 */
export class MultiJointOneEuro {
  constructor(num_channels: number, min_cutoff: number, beta: number, d_cutoff: number);
  /** Constructs with the tuned Document 2 defaults (1.0 / 0.007 / 1.0). */
  static with_defaults(num_channels: number): MultiJointOneEuro;
  readonly num_channels: number;
  /** Smooths `xs` in place at timestamp `t` (seconds). Length must equal num_channels. */
  filter_batch(xs: Float64Array, t: number): void;
  /** Retunes smoothing without dropping history — safe to call from a settings slider. */
  set_params(min_cutoff: number, beta: number): void;
  reset(): void;
  free(): void;
}

/** Mapping from letterboxed model-input coordinates back to source-image pixels. */
export class LetterboxInfo {
  readonly scale: number;
  readonly pad_x: number;
  readonly pad_y: number;
  /** Maps an x in the letterboxed image back to source-image pixels. */
  to_source_x(x: number): number;
  to_source_y(y: number): number;
  free(): void;
}

export class LetterboxResult {
  /** Destination RGBA bytes, `dst_w * dst_h * 4` long. */
  readonly data: Uint8Array;
  readonly info: LetterboxInfo;
  free(): void;
}

/**
 * Aspect-preserving resize into a `dst_w` x `dst_h` RGBA buffer, padding the
 * remainder with opaque black. `src` is RGBA, `src_w * src_h * 4` long.
 */
export function resize_letterbox(
  src: Uint8Array,
  src_w: number,
  src_h: number,
  dst_w: number,
  dst_h: number,
): LetterboxResult;

/** Parsed `WMOC` v1 pose take. Written by TypeScript, read here. */
export class PoseTakeHandle {
  /** Throws if the magic, version, or declared lengths do not check out. */
  static parse(bytes: Uint8Array): PoseTakeHandle;
  readonly frame_count: number;
  readonly joint_count: number;
  readonly fps: number;
  /** All accessors return undefined for an out-of-range frame index. */
  timestamp(frame: number): number | undefined;
  kp2d(frame: number): Float32Array | undefined;
  /** Undefined when the frame carried no 3D estimate. */
  kp3d(frame: number): Float32Array | undefined;
  conf(frame: number): Float32Array | undefined;
  free(): void;
}

/** Coordinate convention of the incoming 3D keypoints, corrected once on entry. */
export enum SourceConvention {
  /** Y-up, right-handed — already canonical. */
  YUp = 0,
  /** Y grows downward, as in image space. */
  YDown = 1,
  /** Z-up, right-handed (Human3.6M-style). */
  ZUp = 2,
}

/**
 * Retargets one frame of 3D COCO-17 keypoints onto the 21-joint target humanoid.
 *
 * Returns a flat `[rootX, rootY, rootZ, ...21 x (qx, qy, qz, qw)]` buffer — 87
 * floats — laid out exactly as the rig ring buffer expects.
 */
export function retarget_pose(
  kp3d: Float32Array,
  conf: Float32Array | undefined,
  convention: SourceConvention,
): Float32Array;

/** Output units for BVH position channels. Blender expects centimetres. */
export enum BvhUnits {
  Meters = 0,
  Centimeters = 1,
}

/** Accumulates retargeted frames and serializes them as a BVH clip. */
export class BvhClip {
  constructor();
  /** Appends one frame in `retarget_pose`'s 87-float layout. Throws on bad length. */
  push_packed(packed: Float32Array): void;
  readonly frame_count: number;
  to_bvh(fps: number, units: BvhUnits): string;
  free(): void;
}

export interface InitOutput {
  readonly memory: WebAssembly.Memory;
}

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

/** Instantiates the WASM module. Must be awaited before any other export. */
export default function init(module_or_path?: InitInput | Promise<InitInput>): Promise<InitOutput>;
