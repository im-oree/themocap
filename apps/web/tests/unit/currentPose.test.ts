/**
 * Document 3 §7.2: the single pose-read path, both backends.
 *
 * The backends are tested through the exported pure readers rather than the
 * hook, because what matters is the data contract — that live and stored
 * sources produce an identically-shaped view — not React plumbing.
 */

import { describe, expect, it } from 'vitest';

/** Float32 round-trips lose precision, so array comparisons need a tolerance. */
function expectClose(received: number[], expected: number[]) {
  expect(received).toHaveLength(expected.length);
  received.forEach((value, i) => expect(value).toBeCloseTo(expected[i]!, 5));
}

import { poseTrackFromFrames } from '@wms/take-model';

import { POSE_LAYOUT } from '../../src/lib/ring/pipelineRings';
import {
  readLiveFrame,
  readStoredFrame,
  type PoseView,
} from '../../src/features/playback/useCurrentPose';
import {
  hasKnownDuration,
  isSeekable,
  poseBackendFor,
  runsInference,
} from '../../src/features/playback/transportMode';

function freshView(): PoseView {
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

const track = poseTrackFromFrames(
  Array.from({ length: 4 }, (_, i) => ({
    t: i * 0.05,
    kp2d: new Float32Array([i, i + 0.1, i + 0.2, i + 0.3]),
    kp3d: new Float32Array([i, i + 1, i + 2, i + 3, i + 4, i + 5]),
    conf: new Float32Array([0.5 + i * 0.1, 0.6]),
  })),
  2,
  20,
);

describe('stored backend', () => {
  it('reads the requested frame', () => {
    const view = readStoredFrame(freshView(), track, 2);
    expect(view.valid).toBe(true);
    expect(view.frameIndex).toBe(2);
    expect(view.t).toBeCloseTo(0.1, 6);
    // Float32 storage, so compare with tolerance rather than exact equality.
    expectClose(Array.from(view.kp2d), [2, 2.1, 2.2, 2.3]);
    expect(Array.from(view.kp3d!)).toEqual([2, 3, 4, 5, 6, 7]);
    expect(view.conf[0]).toBeCloseTo(0.7, 6);
  });

  it('reuses the same buffers across reads instead of reallocating', () => {
    const view = freshView();
    readStoredFrame(view, track, 0);
    const kp2d = view.kp2d;
    const kp3d = view.kp3d;

    readStoredFrame(view, track, 3);

    // Identity, not just equality: a per-frame allocation here would be
    // thousands of garbage objects a second in the render loop.
    expect(view.kp2d).toBe(kp2d);
    expect(view.kp3d).toBe(kp3d);
    expectClose(Array.from(view.kp2d), [3, 3.1, 3.2, 3.3]);
  });

  it('clamps out-of-range indices', () => {
    expect(readStoredFrame(freshView(), track, -5).frameIndex).toBe(0);
    expect(readStoredFrame(freshView(), track, 999).frameIndex).toBe(3);
  });

  it('marks the view invalid for an empty track', () => {
    const view = readStoredFrame(freshView(), poseTrackFromFrames([], 17, 30), 0);
    expect(view.valid).toBe(false);
    expect(view.frameIndex).toBe(-1);
  });

  it('exposes a null kp3d for a track with no 3D data', () => {
    const flat = poseTrackFromFrames(
      [{ t: 0, kp2d: new Float32Array([1, 2]), kp3d: null, conf: new Float32Array([1]) }],
      1,
      30,
    );
    expect(readStoredFrame(freshView(), flat, 0).kp3d).toBeNull();
  });

  it('resizes when moving between tracks with different joint counts', () => {
    const view = freshView();
    readStoredFrame(view, track, 0);
    expect(view.jointCount).toBe(2);

    const wide = poseTrackFromFrames(
      [
        {
          t: 0,
          kp2d: new Float32Array(17 * 2).fill(1),
          kp3d: new Float32Array(17 * 3).fill(2),
          conf: new Float32Array(17).fill(0.5),
        },
      ],
      17,
      30,
    );
    readStoredFrame(view, wide, 0);

    expect(view.jointCount).toBe(17);
    expect(view.kp2d.length).toBe(34);
    expect(view.kp3d!.length).toBe(51);
  });
});

describe('live backend', () => {
  it('reads the ring payload using the layout constants', () => {
    const jointCount = (POSE_LAYOUT.KP3D - POSE_LAYOUT.KP2D) / 2;
    const frame = new Float32Array(POSE_LAYOUT.TOTAL);
    frame[POSE_LAYOUT.KP2D] = 0.25;
    frame[POSE_LAYOUT.KP3D] = 1.5;
    frame[POSE_LAYOUT.CONF] = 0.8;

    const view = readLiveFrame(freshView(), frame);

    expect(view.valid).toBe(true);
    expect(view.jointCount).toBe(jointCount);
    expect(view.kp2d[0]).toBeCloseTo(0.25, 6);
    expect(view.kp3d![0]).toBeCloseTo(1.5, 6);
    expect(view.conf[0]).toBeCloseTo(0.8, 6);
  });

  it('marks the view invalid when the ring has no frame yet', () => {
    expect(readLiveFrame(freshView(), null).valid).toBe(false);
  });

  it('rejects a short payload rather than reading past the end', () => {
    const view = readLiveFrame(freshView(), new Float32Array(4));
    expect(view.valid).toBe(false);
  });

  it('produces the same view shape as the stored backend', () => {
    const live = readLiveFrame(freshView(), new Float32Array(POSE_LAYOUT.TOTAL));
    const stored = readStoredFrame(freshView(), track, 0);

    // Consumers must not need to know which backend they are reading.
    expect(Object.keys(live).sort()).toEqual(Object.keys(stored).sort());
    expect(live.kp3d).not.toBeNull();
  });
});

describe('transport modes', () => {
  it('only stored takes and files are seekable', () => {
    expect(isSeekable('stored-take')).toBe(true);
    expect(isSeekable('file-playback')).toBe(true);
    // Live capture cannot seek: the future has not been recorded.
    expect(isSeekable('live-camera')).toBe(false);
    expect(isSeekable('idle')).toBe(false);
  });

  it('a stored take needs no inference', () => {
    expect(runsInference('stored-take')).toBe(false);
    expect(runsInference('live-camera')).toBe(true);
    expect(runsInference('file-playback')).toBe(true);
  });

  it('maps each mode to a pose backend', () => {
    expect(poseBackendFor('stored-take')).toBe('stored');
    expect(poseBackendFor('live-camera')).toBe('live');
    expect(poseBackendFor('file-playback')).toBe('live');
    expect(poseBackendFor('idle')).toBe('none');
  });

  it('live capture has no known duration', () => {
    expect(hasKnownDuration('live-camera')).toBe(false);
    expect(hasKnownDuration('stored-take')).toBe(true);
  });
});
