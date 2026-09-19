/**
 * The three concrete rings that make up the live pipeline, with their sizes and
 * payload layouts pinned in one place.
 *
 *   capture worker  --frames-->  inference worker  --poses-->  compute worker
 *                                                                    |
 *                                                                 rig |
 *                                                                     v
 *                                                              main thread (render)
 *
 * Slot counts come from the spec (§7) and reflect how far each consumer is
 * allowed to lag: frames get 4-6 because the camera is the fastest producer and
 * inference the slowest consumer; poses and rig get 3, which is enough to absorb
 * one slow tick without ever making the producer wait.
 */

import { allocateRing, type RingBuffers, RingReader, RingWriter } from './ringBuffer';

/** Joints in the target humanoid. Must match `@wms/skeleton`'s `targetHumanoid`. */
export const RIG_JOINT_COUNT = 21;

/**
 * Floats per rig frame: 3 root position + 21 quaternions.
 * Mirrors the `retarget_pose` WASM ABI exactly — see docs/decisions.md.
 */
export const RIG_FLOATS = 3 + RIG_JOINT_COUNT * 4;

/** Source keypoint count (COCO-17) carried in the pose ring. */
export const POSE_JOINT_COUNT = 17;

/**
 * Floats per pose frame: 17x(x, y) 2D + 17x(x, y, z) 3D + 17 confidences.
 * The 3D block is zeroed when the lift model has not run.
 */
export const POSE_FLOATS = POSE_JOINT_COUNT * 2 + POSE_JOINT_COUNT * 3 + POSE_JOINT_COUNT;

export const FRAME_RING_SLOTS = 6;
export const POSE_RING_SLOTS = 3;
export const RIG_RING_SLOTS = 3;

export interface PipelineRings {
  /** RGBA camera frames, capture -> inference. */
  frame: RingBuffers;
  /** Keypoints + confidence, inference -> compute. */
  pose: RingBuffers;
  /** Root position + joint quaternions, compute -> renderer. */
  rig: RingBuffers;
  frameWidth: number;
  frameHeight: number;
}

/**
 * Allocates all three rings for a given capture resolution.
 *
 * Frame slots are sized for full RGBA at the capture resolution. At 640x480x4
 * that is ~1.2 MB per slot, ~7.4 MB for six — acceptable, and the reason the
 * frame ring is not sized for 1080p by default.
 */
export function createPipelineRings(frameWidth: number, frameHeight: number): PipelineRings {
  if (frameWidth <= 0 || frameHeight <= 0) {
    throw new RangeError(
      `createPipelineRings: bad capture size ${frameWidth}x${frameHeight}`,
    );
  }
  return {
    frame: allocateRing(
      FRAME_RING_SLOTS,
      frameWidth * frameHeight * 4,
      Uint8Array.BYTES_PER_ELEMENT,
    ),
    pose: allocateRing(POSE_RING_SLOTS, POSE_FLOATS, Float32Array.BYTES_PER_ELEMENT),
    rig: allocateRing(RIG_RING_SLOTS, RIG_FLOATS, Float32Array.BYTES_PER_ELEMENT),
    frameWidth,
    frameHeight,
  };
}

/** Offsets into a pose ring payload, so producer and consumer cannot disagree. */
export const POSE_LAYOUT = {
  KP2D: 0,
  KP3D: POSE_JOINT_COUNT * 2,
  CONF: POSE_JOINT_COUNT * 2 + POSE_JOINT_COUNT * 3,
  TOTAL: POSE_FLOATS,
} as const;

/** A decoded pose frame, as the compute worker consumes it. */
export interface PoseFrameData {
  frameIndex: number;
  kp2d: Float32Array;
  kp3d: Float32Array;
  conf: Float32Array;
}

/** Packs a pose into a ring slot. Returns the element count written. */
export function packPose(
  slot: Float32Array,
  kp2d: ArrayLike<number>,
  kp3d: ArrayLike<number> | null,
  conf: ArrayLike<number>,
): number {
  slot.set(kp2d as never, POSE_LAYOUT.KP2D);
  if (kp3d) {
    slot.set(kp3d as never, POSE_LAYOUT.KP3D);
  } else {
    slot.fill(0, POSE_LAYOUT.KP3D, POSE_LAYOUT.CONF);
  }
  slot.set(conf as never, POSE_LAYOUT.CONF);
  return POSE_LAYOUT.TOTAL;
}

/** Unpacks a pose ring payload into subarray views (no copy). */
export function unpackPose(data: Float32Array, frameIndex: number): PoseFrameData {
  return {
    frameIndex,
    kp2d: data.subarray(POSE_LAYOUT.KP2D, POSE_LAYOUT.KP3D),
    kp3d: data.subarray(POSE_LAYOUT.KP3D, POSE_LAYOUT.CONF),
    conf: data.subarray(POSE_LAYOUT.CONF, POSE_LAYOUT.TOTAL),
  };
}

/** Offsets into a rig ring payload. Matches `retarget_pose`'s output buffer. */
export const RIG_LAYOUT = {
  ROOT: 0,
  QUATS: 3,
  TOTAL: RIG_FLOATS,
} as const;

/** A decoded rig frame, as the renderer consumes it. */
export interface RigFrameData {
  frameIndex: number;
  /** `[x, y, z]` world position of the Hips joint, in metres. */
  root: Float32Array;
  /** `21 x [x, y, z, w]` parent-relative rotations, flat. */
  quats: Float32Array;
}

export function unpackRig(data: Float32Array, frameIndex: number): RigFrameData {
  return {
    frameIndex,
    root: data.subarray(RIG_LAYOUT.ROOT, RIG_LAYOUT.QUATS),
    quats: data.subarray(RIG_LAYOUT.QUATS, RIG_LAYOUT.TOTAL),
  };
}

/** Convenience constructors so call sites do not repeat the typed-array choice. */
export const makeFrameWriter = (r: RingBuffers) => new RingWriter(r, Uint8Array);
export const makeFrameReader = (r: RingBuffers) => new RingReader(r, Uint8Array);
export const makePoseWriter = (r: RingBuffers) => new RingWriter(r, Float32Array);
export const makePoseReader = (r: RingBuffers) => new RingReader(r, Float32Array);
export const makeRigWriter = (r: RingBuffers) => new RingWriter(r, Float32Array);
export const makeRigReader = (r: RingBuffers) => new RingReader(r, Float32Array);
