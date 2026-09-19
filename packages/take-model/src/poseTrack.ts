/**
 * In-memory pose data for an opened take (Document 3 §7.1 step 3).
 *
 * Deliberately a **struct of flat typed arrays**, not an array of per-frame
 * objects. A 60-second take at 30fps with 17 joints is ~30k keypoints; as
 * objects that is tens of thousands of allocations the GC then has to walk
 * during playback. Flat arrays make per-frame access a pointer offset, and let
 * the whole track be transferred to a worker with zero copying.
 *
 * Document 3 §5.1 is explicit that this is the part which does *not* need
 * chunking: the arrays are a few MB at most. Only video frames and model
 * activations require windowing.
 */

/** Which of a take's two pose tracks is being read (§9.4, §14). */
export type PoseSource = 'raw' | 'refined';

export interface PoseTrack {
  /** Frames in this track. */
  frameCount: number;
  jointCount: number;
  /** Nominal frame rate from the take manifest. */
  fps: number;
  /**
   * Presentation time per frame, seconds from take start. Authoritative for
   * seeking: playback indexes by *timestamp*, never by `index / fps`, because
   * real capture drops frames and a nominal rate drifts from reality.
   */
  timestamps: Float64Array;
  /** `[frame][joint][x,y]` in normalised 0..1 image space. Length `F*J*2`. */
  kp2d: Float32Array;
  /** `[frame][joint][x,y,z]` in metres, Y-up. Length `F*J*3`. Null if unlifted. */
  kp3d: Float32Array | null;
  /** Per-joint confidence 0..1. Length `F*J`. */
  conf: Float32Array;
}

/** Slice offsets for one frame. Avoids recomputing strides at every call site. */
export function frameOffsets(track: PoseTrack, frameIndex: number) {
  const j = track.jointCount;
  return {
    kp2d: frameIndex * j * 2,
    kp3d: frameIndex * j * 3,
    conf: frameIndex * j,
  };
}

/**
 * Nearest frame index for a timestamp, via binary search.
 *
 * Returns the frame whose timestamp is closest, which is what a scrub should
 * land on. Clamps at both ends rather than returning -1: a seek past the end of
 * a clip should show the last frame, not nothing.
 */
export function frameIndexAtTime(track: PoseTrack, seconds: number): number {
  const times = track.timestamps;
  const n = track.frameCount;
  if (n === 0) return 0;
  if (seconds <= times[0]!) return 0;
  if (seconds >= times[n - 1]!) return n - 1;

  let lo = 0;
  let hi = n - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (times[mid]! <= seconds) lo = mid;
    else hi = mid;
  }
  // `lo` and `hi` now bracket the time; pick whichever is nearer.
  return seconds - times[lo]! <= times[hi]! - seconds ? lo : hi;
}

/** Duration in seconds, from the timestamps rather than `count / fps`. */
export function trackDuration(track: PoseTrack): number {
  if (track.frameCount === 0) return 0;
  return track.timestamps[track.frameCount - 1]! - track.timestamps[0]!;
}

/**
 * Builds a `PoseTrack` from the decoded `WMOC` frames produced by the Document 2
 * reader, flattening the per-frame arrays into contiguous storage.
 */
export function poseTrackFromFrames(
  frames: readonly {
    t: number;
    kp2d: Float32Array;
    kp3d: Float32Array | null;
    conf: Float32Array;
  }[],
  jointCount: number,
  fps: number,
): PoseTrack {
  const frameCount = frames.length;
  const timestamps = new Float64Array(frameCount);
  const kp2d = new Float32Array(frameCount * jointCount * 2);
  const conf = new Float32Array(frameCount * jointCount);
  // Only allocate the 3D buffer if at least one frame actually carries 3D data.
  const has3d = frames.some((frame) => frame.kp3d !== null);
  const kp3d = has3d ? new Float32Array(frameCount * jointCount * 3) : null;

  for (let f = 0; f < frameCount; f += 1) {
    const frame = frames[f]!;
    timestamps[f] = frame.t;
    kp2d.set(frame.kp2d, f * jointCount * 2);
    conf.set(frame.conf, f * jointCount);
    if (kp3d && frame.kp3d) kp3d.set(frame.kp3d, f * jointCount * 3);
  }

  return { frameCount, jointCount, fps, timestamps, kp2d, kp3d, conf };
}
