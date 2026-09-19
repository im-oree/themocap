import { describe, expect, it } from 'vitest';

import {
  REFINE_DEFAULTS,
  TAKE_SETTINGS_DEFAULTS,
  describeGapLength,
  withTakeSettingsDefaults,
} from './settings';
import { frameIndexAtTime, poseTrackFromFrames, trackDuration } from './poseTrack';
import {
  REFINE_STAGES,
  STAGE_WEIGHTS,
  computeOverallProgress,
  estimateRemainingSeconds,
} from './refineJob';

describe('withTakeSettingsDefaults', () => {
  it('fills everything from defaults for a Document 2 take with no settings', () => {
    expect(withTakeSettingsDefaults(undefined)).toEqual(TAKE_SETTINGS_DEFAULTS);
    expect(withTakeSettingsDefaults({})).toEqual(TAKE_SETTINGS_DEFAULTS);
  });

  it('preserves values that are present', () => {
    const settings = withTakeSettingsDefaults({
      subjectHeightMeters: 1.82,
      refine: { maxGapFrames: 30, smoothing: { method: 'savgol', cutoffHz: 4 } },
    });
    expect(settings.subjectHeightMeters).toBe(1.82);
    expect(settings.refine.maxGapFrames).toBe(30);
    expect(settings.refine.smoothing.method).toBe('savgol');
    expect(settings.refine.smoothing.cutoffHz).toBe(4);
    // Untouched siblings still come from defaults.
    expect(settings.refine.footContact).toEqual(REFINE_DEFAULTS.footContact);
  });

  it('rejects an implausible subject height rather than trusting it', () => {
    // A stored 0 or 50 is corruption, not a preference. Fall back to "ask again".
    expect(withTakeSettingsDefaults({ subjectHeightMeters: 0 }).subjectHeightMeters).toBeNull();
    expect(withTakeSettingsDefaults({ subjectHeightMeters: 50 }).subjectHeightMeters).toBeNull();
    expect(
      withTakeSettingsDefaults({ subjectHeightMeters: Number.NaN }).subjectHeightMeters,
    ).toBeNull();
  });

  it('rejects an unknown smoothing method', () => {
    const settings = withTakeSettingsDefaults({ refine: { smoothing: { method: 'bogus' } } });
    expect(settings.refine.smoothing.method).toBe('butterworth');
  });

  it('never throws on hostile input', () => {
    for (const input of [null, 0, 'nope', [], { refine: null }, { filter: 7 }]) {
      expect(() => withTakeSettingsDefaults(input)).not.toThrow();
    }
  });
});

describe('describeGapLength', () => {
  it('converts frames to seconds at the take fps', () => {
    expect(describeGapLength(12, 30)).toBe('12 frames (≈0.40s at 30fps)');
    expect(describeGapLength(12, 60)).toBe('12 frames (≈0.20s at 60fps)');
  });

  it('degrades gracefully when fps is unknown', () => {
    expect(describeGapLength(12, 0)).toBe('12 frames');
  });
});

describe('PoseTrack', () => {
  const frames = Array.from({ length: 5 }, (_, i) => ({
    // Deliberately uneven spacing: real capture is not metronomic.
    t: i * 0.033 + (i === 3 ? 0.01 : 0),
    kp2d: new Float32Array([i, i + 0.5]),
    kp3d: new Float32Array([i, i + 1, i + 2]),
    conf: new Float32Array([0.9]),
  }));

  it('flattens per-frame arrays into contiguous storage', () => {
    const track = poseTrackFromFrames(frames, 1, 30);
    expect(track.frameCount).toBe(5);
    expect(track.kp2d.length).toBe(5 * 1 * 2);
    expect(track.kp3d?.length).toBe(5 * 1 * 3);
    expect(Array.from(track.kp2d.slice(4, 6))).toEqual([2, 2.5]);
  });

  it('omits the 3D buffer entirely when no frame has 3D data', () => {
    const track = poseTrackFromFrames(
      frames.map((f) => ({ ...f, kp3d: null })),
      1,
      30,
    );
    expect(track.kp3d).toBeNull();
  });

  it('finds the nearest frame for a timestamp', () => {
    const track = poseTrackFromFrames(frames, 1, 30);
    expect(frameIndexAtTime(track, 0)).toBe(0);
    expect(frameIndexAtTime(track, 0.033)).toBe(1);
    // Between frames 1 and 2 — nearer to 2.
    expect(frameIndexAtTime(track, 0.060)).toBe(2);
  });

  it('clamps rather than failing outside the clip', () => {
    const track = poseTrackFromFrames(frames, 1, 30);
    expect(frameIndexAtTime(track, -10)).toBe(0);
    expect(frameIndexAtTime(track, 9999)).toBe(4);
  });

  it('measures duration from timestamps, not frameCount / fps', () => {
    const track = poseTrackFromFrames(frames, 1, 30);
    // Frame 3 is nudged late, so nominal 4/30 = 0.1333 is wrong.
    expect(trackDuration(track)).toBeCloseTo(0.132, 3);
  });

  it('handles an empty track', () => {
    const track = poseTrackFromFrames([], 17, 30);
    expect(trackDuration(track)).toBe(0);
    expect(frameIndexAtTime(track, 5)).toBe(0);
  });
});

describe('refine progress', () => {
  it('has stage weights summing to 1', () => {
    const total = REFINE_STAGES.reduce((sum, stage) => sum + STAGE_WEIGHTS[stage], 0);
    expect(total).toBeCloseTo(1, 10);
  });

  it('accumulates completed stages into overall progress', () => {
    expect(computeOverallProgress('pose2d', 0)).toBe(0);
    expect(computeOverallProgress('pose2d', 1)).toBeCloseTo(0.45, 10);
    // lift3d half done = all of pose2d + half of lift3d.
    expect(computeOverallProgress('lift3d', 0.5)).toBeCloseTo(0.45 + 0.15, 10);
    expect(computeOverallProgress('finalize', 1)).toBeCloseTo(1, 10);
  });

  it('increases monotonically across the whole pipeline', () => {
    let previous = -1;
    for (const stage of REFINE_STAGES) {
      for (const p of [0, 0.5, 1]) {
        const value = computeOverallProgress(stage, p);
        expect(value).toBeGreaterThanOrEqual(previous);
        previous = value;
      }
    }
    expect(previous).toBeCloseTo(1, 10);
  });

  it('clamps out-of-range stage progress', () => {
    expect(computeOverallProgress('pose2d', -5)).toBe(0);
    expect(computeOverallProgress('pose2d', 5)).toBeCloseTo(0.45, 10);
  });

  it('withholds a remaining-time estimate until progress is meaningful', () => {
    expect(estimateRemainingSeconds(0, 10)).toBeNull();
    expect(estimateRemainingSeconds(0.01, 10)).toBeNull();
    // 25% done after 10s => ~30s left.
    expect(estimateRemainingSeconds(0.25, 10)).toBeCloseTo(30, 5);
  });
});
