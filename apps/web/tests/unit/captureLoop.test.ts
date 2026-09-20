/**
 * CaptureLoop: the driver that turns video frames into poses and takes.
 *
 * Uses an injected scheduler so frames are stepped deterministically rather
 * than waiting on rAF — timing-dependent tests here would be flaky and would
 * not actually check the behaviours that matter (back-pressure, error
 * recovery, recording boundaries).
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { CaptureLoop } from '../../src/features/capture/captureLoop';
import { decodeTake } from '../../src/features/recording/TakeWriter';
import { resetClockInstances } from '../../src/lib/clock/clockInstance';
import type { FrameSource, PoseEstimator } from '../../src/features/capture/poseEstimator';

/** Steps the loop manually, one tick at a time. */
function manualScheduler() {
  let pending: (() => void) | null = null;
  const scheduler = (callback: () => void) => {
    pending = callback;
    return () => {
      pending = null;
    };
  };
  /** Runs one queued tick and lets its promise chain settle. */
  const step = async () => {
    const next = pending;
    pending = null;
    next?.();
    // Two macrotask turns: the tick awaits estimate(), then reschedules.
    await Promise.resolve();
    await Promise.resolve();
    await new Promise((r) => setTimeout(r, 0));
  };
  return { scheduler, step, hasPending: () => pending !== null };
}

/** An estimator stub with controllable latency and failure. */
function makeEstimator(options: { score?: number; fail?: boolean; hang?: boolean } = {}) {
  let resolveHang: (() => void) | null = null;
  const estimate = vi.fn(async () => {
    if (options.fail) throw new Error('decode failed');
    if (options.hang) await new Promise<void>((r) => (resolveHang = r));
    return {
      keypoints: Array.from({ length: 17 }, (_, i) => ({
        x: i / 17,
        y: 0.5,
        score: options.score ?? 0.9,
      })),
      inferenceMs: 5,
      meanScore: options.score ?? 0.9,
    };
  });
  return {
    estimator: { estimate } as unknown as PoseEstimator,
    estimate,
    release: () => resolveHang?.(),
  };
}

const SOURCE = { videoWidth: 640, videoHeight: 480 } as FrameSource;

beforeEach(() => {
  resetClockInstances();
});

describe('lifecycle', () => {
  it('does not run until started', async () => {
    const { scheduler, hasPending } = manualScheduler();
    const { estimate } = makeEstimator();
    new CaptureLoop({ estimator: makeEstimator().estimator, source: SOURCE, scheduler });
    expect(hasPending()).toBe(false);
    expect(estimate).not.toHaveBeenCalled();
  });

  it('processes frames once started', async () => {
    const { scheduler, step } = manualScheduler();
    const { estimator, estimate } = makeEstimator();
    const loop = new CaptureLoop({ estimator, source: SOURCE, scheduler });

    loop.start();
    await step();
    await step();

    expect(estimate).toHaveBeenCalledTimes(2);
    expect(loop.stats.processed).toBe(2);
  });

  it('start() twice does not double-schedule', async () => {
    const { scheduler, step } = manualScheduler();
    const { estimator, estimate } = makeEstimator();
    const loop = new CaptureLoop({ estimator, source: SOURCE, scheduler });

    loop.start();
    loop.start();
    await step();

    expect(estimate).toHaveBeenCalledTimes(1);
  });

  it('stop() halts processing', async () => {
    const { scheduler, step, hasPending } = manualScheduler();
    const { estimator, estimate } = makeEstimator();
    const loop = new CaptureLoop({ estimator, source: SOURCE, scheduler });

    loop.start();
    await step();
    loop.stop();

    expect(loop.isRunning).toBe(false);
    expect(hasPending()).toBe(false);
    const before = estimate.mock.calls.length;
    await step();
    expect(estimate).toHaveBeenCalledTimes(before);
  });
});

describe('back-pressure', () => {
  it('drops frames instead of queueing while inference is busy', async () => {
    const { scheduler, step } = manualScheduler();
    const { estimator, estimate, release } = makeEstimator({ hang: true });
    const loop = new CaptureLoop({ estimator, source: SOURCE, scheduler });

    loop.start();
    await step(); // starts an inference that will not resolve
    await step(); // must be dropped, not queued
    await step();

    // Queueing would grow an unbounded backlog and make the preview drift
    // further behind reality with every frame.
    expect(estimate).toHaveBeenCalledTimes(1);
    expect(loop.stats.dropped).toBeGreaterThan(0);
    release();
  });
});

describe('error handling', () => {
  it('reports a frame error without stopping the session', async () => {
    const { scheduler, step } = manualScheduler();
    const { estimator } = makeEstimator({ fail: true });
    const onError = vi.fn();
    const loop = new CaptureLoop({ estimator, source: SOURCE, scheduler, onError });

    loop.start();
    await step();

    expect(onError).toHaveBeenCalledOnce();
    // A transient decode failure must not lose a recording in progress.
    expect(loop.isRunning).toBe(true);
  });
});

describe('recording', () => {
  it('records nothing until startRecording is called', async () => {
    const { scheduler, step } = manualScheduler();
    const { estimator } = makeEstimator();
    const loop = new CaptureLoop({ estimator, source: SOURCE, scheduler });

    loop.start();
    await step();

    expect(loop.isRecording).toBe(false);
    expect(loop.finishRecording()).toBeNull();
  });

  it('produces a decodable WMOC file from recorded frames', async () => {
    const { scheduler, step } = manualScheduler();
    const { estimator } = makeEstimator();
    const loop = new CaptureLoop({ estimator, source: SOURCE, scheduler });

    loop.start();
    loop.startRecording(17, 30);
    await step();
    await step();
    await step();
    const take = loop.finishRecording();

    expect(take).not.toBeNull();
    expect(take!.frameCount).toBe(3);

    // Round-trip through the real reader: a file that cannot be decoded is
    // worthless regardless of how many frames it claims.
    const decoded = decodeTake(take!.bytes);
    expect(decoded.frames).toHaveLength(3);
    expect(decoded.jointCount).toBe(17);
    expect(decoded.fps).toBe(30);
    expect(decoded.frames[0]!.kp2d).toHaveLength(34);
    expect(decoded.frames[0]!.conf[0]).toBeCloseTo(0.9, 4);
  });

  it('writes monotonically increasing timestamps', async () => {
    const { scheduler, step } = manualScheduler();
    const { estimator } = makeEstimator();
    const loop = new CaptureLoop({ estimator, source: SOURCE, scheduler });

    loop.start();
    loop.startRecording(17, 30);
    for (let i = 0; i < 4; i += 1) await step();
    const decoded = decodeTake(loop.finishRecording()!.bytes);

    // Document 3's seeking derives entirely from these timestamps, so
    // non-monotonic values would break frame-accurate scrubbing.
    const times = decoded.frames.map((f) => f.t);
    for (let i = 1; i < times.length; i += 1) {
      expect(times[i]).toBeGreaterThanOrEqual(times[i - 1]!);
    }
  });

  it('returns null for a recording that captured no frames', async () => {
    const { scheduler } = manualScheduler();
    const { estimator } = makeEstimator();
    const loop = new CaptureLoop({ estimator, source: SOURCE, scheduler });

    loop.startRecording(17, 30);
    // A zero-frame take is not a file worth writing, and decodeTake rejects it.
    expect(loop.finishRecording()).toBeNull();
  });

  it('keeps running after recording stops', async () => {
    const { scheduler, step } = manualScheduler();
    const { estimator } = makeEstimator();
    const loop = new CaptureLoop({ estimator, source: SOURCE, scheduler });

    loop.start();
    loop.startRecording(17, 30);
    await step();
    loop.finishRecording();
    await step();

    // The live preview must survive the end of a recording.
    expect(loop.isRunning).toBe(true);
    expect(loop.isRecording).toBe(false);
    expect(loop.stats.processed).toBe(2);
  });
});

describe('frame callback', () => {
  it('emits keypoints and an advancing frame index', async () => {
    const { scheduler, step } = manualScheduler();
    const { estimator } = makeEstimator({ score: 0.42 });
    const frames: number[] = [];
    const loop = new CaptureLoop({
      estimator,
      source: SOURCE,
      scheduler,
      onFrame: (f) => frames.push(f.frameIndex),
    });

    loop.start();
    await step();
    await step();

    expect(frames).toHaveLength(2);
    expect(frames[1]).toBeGreaterThan(frames[0]!);
  });

  it('passes mean score through for the "is anyone there" signal', async () => {
    const { scheduler, step } = manualScheduler();
    const { estimator } = makeEstimator({ score: 0.15 });
    const onFrame = vi.fn();
    const loop = new CaptureLoop({ estimator, source: SOURCE, scheduler, onFrame });

    loop.start();
    await step();

    expect(onFrame.mock.calls[0]![0].meanScore).toBeCloseTo(0.15, 4);
  });
});
