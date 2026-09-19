/**
 * Frame-accurate seeking for stored takes (Document 3 §7.3).
 *
 * The acceptance criterion is that the video monitor, the 3D viewport and the
 * timeline all agree on the frame index within ±1 frame at any scrub position.
 * That is harder than it sounds, for one reason:
 *
 * **A `<video>` element's `currentTime` is not a frame index.** Setting it seeks
 * to the nearest *keyframe* and then decodes forward, and the time it reports
 * back is the presentation time of whatever frame it actually landed on — which
 * may differ from what was requested by up to a frame interval. Meanwhile the
 * pose track has its own per-frame timestamps recorded at capture time, which
 * drift from `index / fps` because real capture drops frames.
 *
 * So the rule enforced here is: **both the video and the pose derive from the
 * same stored per-frame timestamps, never from wall-clock and never from a
 * nominal frame rate.** The pose track's timestamps are the single source of
 * truth; the video is told to go to a pose frame's timestamp, and after it
 * settles, the frame index is recomputed from the time it actually reached.
 */

import { frameIndexAtTime, type PoseTrack } from '@wms/take-model';

/**
 * Seek target expressed in the only unit that is unambiguous: a frame index
 * into the pose track, plus the timestamp that frame was captured at.
 */
export interface SeekTarget {
  frameIndex: number;
  /** Presentation time in seconds for that frame. */
  t: number;
}

export function seekTargetForFrame(track: PoseTrack, frameIndex: number): SeekTarget {
  if (track.frameCount === 0) return { frameIndex: 0, t: 0 };
  const index = Math.min(track.frameCount - 1, Math.max(0, Math.trunc(frameIndex)));
  return { frameIndex: index, t: track.timestamps[index]! };
}

export function seekTargetForTime(track: PoseTrack, seconds: number): SeekTarget {
  return seekTargetForFrame(track, frameIndexAtTime(track, seconds));
}

/**
 * Nudge applied when asking the video to display a frame.
 *
 * A video decoder displays the frame whose presentation interval *contains*
 * `currentTime`. Asking for exactly a frame's start timestamp lands on a
 * boundary, where floating-point error can tip the decoder onto the previous
 * frame. Biasing by a fraction of a frame interval puts the request safely
 * inside the intended frame's interval.
 *
 * A quarter-frame is small enough never to reach the next frame and large
 * enough to clear any plausible rounding error.
 */
export const FRAME_BIAS_FRACTION = 0.25;

export function videoTimeForFrame(track: PoseTrack, frameIndex: number): number {
  const target = seekTargetForFrame(track, frameIndex);
  const interval = frameIntervalAt(track, target.frameIndex);
  return target.t + interval * FRAME_BIAS_FRACTION;
}

/**
 * Interval to the next frame, measured from the timestamps rather than assumed
 * from `1 / fps`, falling back to the nominal rate at the final frame.
 */
export function frameIntervalAt(track: PoseTrack, frameIndex: number): number {
  const nominal = track.fps > 0 ? 1 / track.fps : 1 / 30;
  if (track.frameCount < 2) return nominal;
  const index = Math.min(track.frameCount - 2, Math.max(0, frameIndex));
  const delta = track.timestamps[index + 1]! - track.timestamps[index]!;
  return delta > 0 ? delta : nominal;
}

/**
 * Resolves the frame index the video actually reached.
 *
 * Called after a `seeked` event with the element's real `currentTime`.
 *
 * This is **containment**, not nearest-match: a decoder displays the frame whose
 * presentation interval contains the current time, so the answer is the last
 * frame whose timestamp is at or before it. Using nearest-match here was a real
 * bug — a decoder reports the exact frame start timestamp, and "nearest" on a
 * tie rounds to the *previous* frame, putting the viewport one frame behind the
 * video across every dropped-frame discontinuity.
 *
 * A small epsilon absorbs float error in the decoder's reported time so a value
 * a hair under a frame boundary still resolves to that frame.
 */
export function frameIndexForVideoTime(track: PoseTrack, videoTime: number): number {
  const n = track.frameCount;
  if (n === 0) return 0;
  const times = track.timestamps;
  const epsilon = 1e-6;
  if (videoTime + epsilon < times[0]!) return 0;
  if (videoTime >= times[n - 1]!) return n - 1;

  let lo = 0;
  let hi = n - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (times[mid]! <= videoTime + epsilon) lo = mid;
    else hi = mid;
  }
  return lo;
}

/**
 * Drives a `<video>` to a frame and resolves once it has settled.
 *
 * Resolves with the frame index actually reached, which the caller should treat
 * as authoritative and propagate to the viewport and timeline — that is what
 * keeps all three in agreement instead of each holding its own guess.
 */
export async function seekVideoToFrame(
  video: HTMLVideoElement,
  track: PoseTrack,
  frameIndex: number,
  timeoutMs = 2000,
): Promise<number> {
  const target = seekTargetForFrame(track, frameIndex);
  const requested = videoTimeForFrame(track, target.frameIndex);

  // Already there: setting currentTime to its present value fires no `seeked`
  // event, so awaiting one would hang until the timeout.
  if (Math.abs(video.currentTime - requested) < 1e-6) {
    return frameIndexForVideoTime(track, video.currentTime);
  }

  await new Promise<void>((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      video.removeEventListener('seeked', finish);
      clearTimeout(timer);
      resolve();
    };
    // A seek into an undecodable region can never fire `seeked`. Time out and
    // carry on with whatever position the element reports rather than wedging
    // the transport forever.
    const timer = setTimeout(finish, timeoutMs);
    video.addEventListener('seeked', finish);
    video.currentTime = requested;
  });

  return frameIndexForVideoTime(track, video.currentTime);
}
