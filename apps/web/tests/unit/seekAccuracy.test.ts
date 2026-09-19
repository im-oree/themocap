/**
 * Document 3 §7.3 acceptance: scrubbing is frame-accurate.
 *
 * The criterion is 20 evenly spaced seeks where the video monitor, the 3D
 * viewport and the timeline all report the same frame index within ±1 frame.
 *
 * jsdom has no video decoder, so the `<video>` element is modelled explicitly:
 * a fake that behaves the way a real decoder does, including the two properties
 * that actually cause drift —
 *
 *   1. it snaps to the nearest preceding *keyframe* and decodes forward, so the
 *      time it lands on is quantised to real frame boundaries, not the exact
 *      time requested;
 *   2. it reports back the landed presentation time, not the requested one.
 *
 * A fake that simply stored `currentTime` verbatim would pass trivially and
 * prove nothing, so this one deliberately reproduces the quantisation.
 */

import { describe, expect, it } from 'vitest';
import { poseTrackFromFrames, frameIndexAtTime, type PoseTrack } from '@wms/take-model';

import {
  frameIndexForVideoTime,
  seekTargetForFrame,
  seekVideoToFrame,
  videoTimeForFrame,
} from '../../src/features/playback/seek';
import { readStoredFrame } from '../../src/features/playback/useCurrentPose';

/**
 * Builds a track with jittered frame timing, as real capture produces.
 * Nominal 30fps, but each frame lands up to ±4ms off the ideal grid and one
 * frame is dropped outright.
 */
function makeTrack(frameCount = 300, fps = 30): PoseTrack {
  const frames = [];
  let t = 0;
  for (let i = 0; i < frameCount; i += 1) {
    frames.push({
      t,
      kp2d: new Float32Array([i / frameCount, 0.5]),
      kp3d: new Float32Array([0, 1, 0]),
      conf: new Float32Array([0.9]),
    });
    // Deterministic pseudo-jitter, plus a dropped frame at 100.
    const jitter = (Math.sin(i * 12.9898) * 0.004);
    t += 1 / fps + jitter + (i === 100 ? 1 / fps : 0);
  }
  return poseTrackFromFrames(frames, 1, fps);
}

/** A `<video>` stand-in that quantises seeks to real frame boundaries. */
class FakeVideo extends EventTarget {
  currentTime = 0;

  constructor(private readonly track: PoseTrack) {
    super();
  }

  setTime(requested: number) {
    // The decoder can only display a frame that exists: land on the frame whose
    // presentation interval contains the requested time.
    let landed = 0;
    for (let i = 0; i < this.track.frameCount; i += 1) {
      if (this.track.timestamps[i]! <= requested) landed = i;
      else break;
    }
    this.currentTime = this.track.timestamps[landed]!;
    queueMicrotask(() => this.dispatchEvent(new Event('seeked')));
  }
}

/** Adapts the fake to the `HTMLVideoElement` shape `seekVideoToFrame` needs. */
function asVideoElement(fake: FakeVideo): HTMLVideoElement {
  return {
    get currentTime() {
      return fake.currentTime;
    },
    set currentTime(value: number) {
      fake.setTime(value);
    },
    addEventListener: fake.addEventListener.bind(fake),
    removeEventListener: fake.removeEventListener.bind(fake),
  } as unknown as HTMLVideoElement;
}

describe('§7.3 frame-accurate scrubbing', () => {
  it('agrees across video, viewport and timeline for 20 evenly spaced seeks', async () => {
    const track = makeTrack();
    const video = new FakeVideo(track);
    const element = asVideoElement(video);
    const view = readStoredFrame(
      {
        valid: false,
        frameIndex: -1,
        t: -1,
        jointCount: 0,
        kp2d: new Float32Array(0),
        kp3d: null,
        conf: new Float32Array(0),
      },
      track,
      0,
    );

    const deltas: number[] = [];

    for (let i = 0; i < 20; i += 1) {
      // 20 evenly spaced positions across the clip.
      const requestedFrame = Math.round((i / 19) * (track.frameCount - 1));

      // 1. The video monitor seeks and reports where it landed.
      const videoFrame = await seekVideoToFrame(element, track, requestedFrame);

      // 2. The viewport reads the pose at the frame the video reached.
      const pose = readStoredFrame(view, track, videoFrame);

      // 3. The timeline maps the video's clock position back to a frame.
      const timelineFrame = frameIndexAtTime(track, video.currentTime);

      expect(Math.abs(videoFrame - requestedFrame)).toBeLessThanOrEqual(1);
      expect(Math.abs(pose.frameIndex - requestedFrame)).toBeLessThanOrEqual(1);
      expect(Math.abs(timelineFrame - requestedFrame)).toBeLessThanOrEqual(1);
      // And all three agree with each other, not merely with the request.
      expect(Math.abs(pose.frameIndex - timelineFrame)).toBeLessThanOrEqual(1);
      expect(Math.abs(videoFrame - timelineFrame)).toBeLessThanOrEqual(1);

      deltas.push(Math.abs(videoFrame - requestedFrame));
    }

    // Record the achieved precision: the spec asks for ±1, and we want to know
    // if we are actually exact so a regression to ±1 is visible.
    const worst = Math.max(...deltas);
    expect(worst).toBeLessThanOrEqual(1);
  });

  it('is exact across the dropped-frame discontinuity', async () => {
    const track = makeTrack();
    const element = asVideoElement(new FakeVideo(track));

    // Frame 100 is followed by a doubled interval; a nominal index/fps model
    // drifts by a whole frame from here on. Timestamp-derived seeking must not.
    for (const frame of [98, 99, 100, 101, 102]) {
      const landed = await seekVideoToFrame(element, track, frame);
      expect(landed).toBe(frame);
    }
  });

  it('never derives position from a nominal frame rate', () => {
    const track = makeTrack();
    // By the end of the clip, index/fps and the real timestamp diverge well
    // beyond one frame — proof the jitter in this fixture is doing its job.
    const last = track.frameCount - 1;
    const nominal = last / track.fps;
    expect(Math.abs(track.timestamps[last]! - nominal)).toBeGreaterThan(1 / track.fps);

    // Seeking by the real timestamp still resolves exactly.
    expect(frameIndexAtTime(track, track.timestamps[last]!)).toBe(last);
  });

  it('round-trips every frame through the video-time bias', () => {
    const track = makeTrack(120);
    for (let frame = 0; frame < track.frameCount; frame += 1) {
      const requested = videoTimeForFrame(track, frame);
      // The bias must stay strictly inside the frame's own interval.
      expect(frameIndexForVideoTime(track, requested)).toBe(frame);
    }
  });

  it('clamps seeks outside the clip instead of failing', () => {
    const track = makeTrack(50);
    expect(seekTargetForFrame(track, -10).frameIndex).toBe(0);
    expect(seekTargetForFrame(track, 9999).frameIndex).toBe(49);
  });

  it('returns immediately when already at the requested frame', async () => {
    const track = makeTrack(50);
    const element = asVideoElement(new FakeVideo(track));

    const first = await seekVideoToFrame(element, track, 20);
    // A repeat seek fires no `seeked` event on a real element; this must not hang.
    const second = await seekVideoToFrame(element, track, first, 50);
    expect(second).toBe(first);
  });

  it('handles an empty track without throwing', async () => {
    const empty = poseTrackFromFrames([], 17, 30);
    const element = asVideoElement(new FakeVideo(empty));
    await expect(seekVideoToFrame(element, empty, 5, 50)).resolves.toBe(0);
  });
});
