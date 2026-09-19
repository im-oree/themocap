/**
 * The single pose-read path for every consumer (Document 3 §7.2).
 *
 * The Viewport, the 2D overlay and the Properties panel all read poses through
 * this one hook. That is the whole point: there are two completely different
 * storage backends behind it —
 *
 *   - **live**: a lock-free ring buffer written by the inference worker, read
 *     at whatever rate the renderer manages, where "current" means "newest";
 *   - **stored**: a flat `PoseTrack` in memory, indexed by frame, where
 *     "current" means "the frame the transport is parked on".
 *
 * If consumers reached into either one directly, Document 4's timeline work
 * would have to touch Viewport internals to add a third mode. With this hook,
 * adding a mode is a change in exactly one file.
 *
 * The returned object is a **stable, mutated-in-place view**, not a fresh
 * allocation per frame. At 60fps a new object with three typed-array copies per
 * frame is thousands of allocations a second; the render loop reads the view
 * immediately and does not retain it, so mutation is safe and free.
 */

import { useCallback, useMemo, useRef } from 'react';
import { frameIndexAtTime, frameOffsets, type PoseTrack } from '@wms/take-model';

import { POSE_LAYOUT } from '../../lib/ring/pipelineRings';

/** A read-only window onto one frame's pose. Valid until the next read. */
export interface PoseView {
  /** True when the view holds real data; false means "nothing to draw". */
  valid: boolean;
  /** Frame index within the source, or -1 when invalid. */
  frameIndex: number;
  /** Presentation time in seconds, or -1 when invalid. */
  t: number;
  jointCount: number;
  /** `[x,y]` per joint, normalised image space. */
  kp2d: Float32Array;
  /** `[x,y,z]` per joint in metres, or null when the source has no 3D. */
  kp3d: Float32Array | null;
  conf: Float32Array;
}

function emptyView(): PoseView {
  return {
    valid: false,
    frameIndex: -1,
    t: -1,
    jointCount: 0,
    kp2d: new Float32Array(0),
    kp3d: null,
    conf: new Float32Array(0),
  };
}

/** Grows the view's buffers if the joint count changed. */
function ensureCapacity(view: PoseView, jointCount: number, want3d: boolean): void {
  if (view.jointCount !== jointCount) {
    view.jointCount = jointCount;
    view.kp2d = new Float32Array(jointCount * 2);
    view.conf = new Float32Array(jointCount);
    view.kp3d = want3d ? new Float32Array(jointCount * 3) : null;
    return;
  }
  if (want3d && !view.kp3d) view.kp3d = new Float32Array(jointCount * 3);
  if (!want3d && view.kp3d) view.kp3d = null;
}

/** Copies one frame out of a stored track into the reusable view. */
export function readStoredFrame(
  view: PoseView,
  track: PoseTrack,
  frameIndex: number,
): PoseView {
  if (track.frameCount === 0) {
    view.valid = false;
    view.frameIndex = -1;
    view.t = -1;
    return view;
  }

  // Clamp rather than fail: a transport parked one frame past the end during a
  // scrub should show the last frame, not blank the viewport.
  const index = Math.min(track.frameCount - 1, Math.max(0, Math.trunc(frameIndex)));
  ensureCapacity(view, track.jointCount, track.kp3d !== null);

  const at = frameOffsets(track, index);
  view.kp2d.set(track.kp2d.subarray(at.kp2d, at.kp2d + track.jointCount * 2));
  view.conf.set(track.conf.subarray(at.conf, at.conf + track.jointCount));
  if (view.kp3d && track.kp3d) {
    view.kp3d.set(track.kp3d.subarray(at.kp3d, at.kp3d + track.jointCount * 3));
  }

  view.valid = true;
  view.frameIndex = index;
  view.t = track.timestamps[index]!;
  return view;
}

/** Copies the newest ring-buffer frame into the reusable view. */
export function readLiveFrame(view: PoseView, frame: Float32Array | null): PoseView {
  if (!frame || frame.length < POSE_LAYOUT.TOTAL) {
    view.valid = false;
    view.frameIndex = -1;
    view.t = -1;
    return view;
  }

  // The live ring carries a fixed 17-joint COCO payload; its layout constants
  // are the contract, not the array length.
  const jointCount = (POSE_LAYOUT.KP3D - POSE_LAYOUT.KP2D) / 2;
  ensureCapacity(view, jointCount, true);

  view.kp2d.set(frame.subarray(POSE_LAYOUT.KP2D, POSE_LAYOUT.KP2D + jointCount * 2));
  view.kp3d!.set(frame.subarray(POSE_LAYOUT.KP3D, POSE_LAYOUT.KP3D + jointCount * 3));
  view.conf.set(frame.subarray(POSE_LAYOUT.CONF, POSE_LAYOUT.CONF + jointCount));

  view.valid = true;
  return view;
}

export type PoseReaderSource =
  | { kind: 'stored'; track: PoseTrack | null }
  | { kind: 'live'; read: () => Float32Array | null };

export interface PoseReader {
  /**
   * Reads the pose at `frameIndex`. Ignored by the live backend, which always
   * returns the newest frame — "current" has no index when data is streaming.
   */
  at: (frameIndex: number) => PoseView;
  /** Reads the pose nearest a timestamp. Stored sources only. */
  atTime: (seconds: number) => PoseView;
  /** Frames available, or 0 for a live source. */
  frameCount: number;
}

/**
 * Returns a stable reader for the current pose source.
 *
 * The reader identity only changes when the source does, so a render loop can
 * capture it once in a ref without re-subscribing every frame.
 */
export function useCurrentPose(source: PoseReaderSource): PoseReader {
  const viewRef = useRef<PoseView | null>(null);
  if (viewRef.current === null) viewRef.current = emptyView();
  const view = viewRef.current;

  const isStored = source.kind === 'stored';
  const track = isStored ? source.track : null;
  const read = source.kind === 'live' ? source.read : null;

  const at = useCallback(
    (frameIndex: number): PoseView => {
      if (track) return readStoredFrame(view, track, frameIndex);
      if (read) return readLiveFrame(view, read());
      view.valid = false;
      view.frameIndex = -1;
      return view;
    },
    [track, read, view],
  );

  const atTime = useCallback(
    (seconds: number): PoseView => {
      if (!track) return at(0);
      return readStoredFrame(view, track, frameIndexAtTime(track, seconds));
    },
    [track, at, view],
  );

  return useMemo(
    () => ({ at, atTime, frameCount: track?.frameCount ?? 0 }),
    [at, atTime, track],
  );
}
