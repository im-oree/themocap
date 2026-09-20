/**
 * The per-frame capture loop: video frame in, pose out, optionally recorded.
 *
 * This is the piece that was entirely missing — every component around it
 * existed (clock, ring buffers, estimator, WMOC writer, storage) but nothing
 * drove them, so no take could ever be produced.
 *
 * Deliberately a plain class rather than a hook: it outlives React renders, and
 * its stop path must run exactly once in a specific order. Effect cleanup
 * ordering is not a good place for that.
 */

import { getMasterClock, getRateMeter } from '../../lib/clock/clockInstance';
import { TakeWriter } from '../recording/TakeWriter';
import type { Keypoint } from './movenet';
import type { FrameSource, PoseEstimator } from './poseEstimator';

export interface CaptureFrame {
  frameIndex: number;
  /** Seconds since the loop started. */
  t: number;
  keypoints: Keypoint[];
  meanScore: number;
  inferenceMs: number;
}

export interface CaptureLoopOptions {
  estimator: PoseEstimator;
  source: FrameSource;
  /** Called for every successfully processed frame. */
  onFrame?: (frame: CaptureFrame) => void;
  onError?: (error: unknown) => void;
  /**
   * Upper bound on processing rate. Inference slower than this simply runs as
   * fast as it can; this only prevents burning CPU when it is faster.
   */
  targetFps?: number;
  /** Injectable for tests; defaults to rAF, falling back to a timer. */
  scheduler?: (callback: () => void) => () => void;
}

function defaultScheduler(callback: () => void): () => void {
  if (typeof requestAnimationFrame === 'function') {
    const id = requestAnimationFrame(() => callback());
    return () => cancelAnimationFrame(id);
  }
  // A worker or a headless test has no rAF. 16ms approximates 60Hz.
  const id = setTimeout(callback, 16);
  return () => clearTimeout(id);
}

export class CaptureLoop {
  private running = false;
  private cancelScheduled: (() => void) | null = null;
  private inFlight = false;
  private writer: TakeWriter | null = null;
  private startedAt = 0;
  private lastFrameAt = 0;
  private processed = 0;
  private dropped = 0;

  constructor(private readonly options: CaptureLoopOptions) {}

  get isRunning(): boolean {
    return this.running;
  }

  get isRecording(): boolean {
    return this.writer !== null;
  }

  /** Frames processed and frames skipped because inference was still busy. */
  get stats(): { processed: number; dropped: number; fps: number } {
    return { processed: this.processed, dropped: this.dropped, fps: getRateMeter().fps };
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.startedAt = performance.now();
    this.lastFrameAt = 0;
    this.processed = 0;
    this.dropped = 0;
    this.schedule();
  }

  stop(): void {
    this.running = false;
    this.cancelScheduled?.();
    this.cancelScheduled = null;
  }

  /** Begins buffering poses into a WMOC file. */
  startRecording(jointCount: number, fps: number): void {
    this.writer = new TakeWriter(jointCount, fps);
  }

  /**
   * Ends recording and returns the encoded take.
   *
   * Returns null if nothing was recorded — a zero-frame take is not a file
   * worth writing, and `decodeTake` would reject it anyway.
   */
  finishRecording(): { bytes: Uint8Array; frameCount: number } | null {
    const writer = this.writer;
    this.writer = null;
    if (!writer || writer.frameCount === 0) return null;
    return { bytes: writer.finish(), frameCount: writer.frameCount };
  }

  private schedule(): void {
    if (!this.running) return;
    this.cancelScheduled = this.options.scheduler?.(() => void this.tick()) ??
      defaultScheduler(() => void this.tick());
  }

  private async tick(): Promise<void> {
    if (!this.running) return;

    const now = performance.now();
    const minInterval = this.options.targetFps ? 1000 / this.options.targetFps : 0;

    // Two guards, for different problems:
    //  - `inFlight` drops frames while inference is still running. Queueing
    //    them instead would grow an unbounded backlog and make the preview lag
    //    further behind reality with every frame.
    //  - the interval check avoids running faster than asked.
    if (this.inFlight || (minInterval > 0 && now - this.lastFrameAt < minInterval)) {
      if (this.inFlight) this.dropped += 1;
      this.schedule();
      return;
    }

    this.inFlight = true;
    this.lastFrameAt = now;

    // Re-arm the scheduler *before* awaiting inference, not after.
    //
    // Scheduling only in `finally` means that while a frame is in flight there
    // is no pending callback at all, so the loop's liveness depends entirely on
    // that promise settling. An estimator that never resolves — a wedged wasm
    // session, a lost GL context mid-decode — would silently stop the loop
    // forever with no error and no way to recover. Re-arming first keeps ticks
    // arriving; they see `inFlight` and count themselves as dropped, which is
    // also what makes the drop counter a truthful back-pressure signal.
    this.schedule();

    try {
      const result = await this.options.estimator.estimate(this.options.source);
      if (result && this.running) {
        const tick = getMasterClock().tick();
        const t = (performance.now() - this.startedAt) / 1000;
        // RateMeter samples in seconds, matching the clock's own units.
        getRateMeter().sample(t);

        if (this.writer) {
          const { keypoints } = result;
          const kp2d = new Float32Array(keypoints.length * 2);
          const conf = new Float32Array(keypoints.length);
          for (let i = 0; i < keypoints.length; i += 1) {
            kp2d[i * 2] = keypoints[i]!.x;
            kp2d[i * 2 + 1] = keypoints[i]!.y;
            conf[i] = keypoints[i]!.score;
          }
          // kp3d is null until the lift stage exists; the WMOC format already
          // supports its absence, so raw takes stay valid and refine can add it.
          this.writer.push({ t, kp2d, kp3d: null, conf });
        }

        this.processed += 1;
        this.options.onFrame?.({
          frameIndex: tick.frameIndex,
          t,
          keypoints: result.keypoints,
          meanScore: result.meanScore,
          inferenceMs: result.inferenceMs,
        });
      }
    } catch (cause) {
      // One bad frame must not kill the session — a transient decode failure
      // during a resolution change is recoverable, and stopping would lose the
      // recording in progress.
      this.options.onError?.(cause);
    } finally {
      this.inFlight = false;
      // Already re-armed above; scheduling again here would double the tick
      // rate and each extra tick would spawn another inference.
    }
  }
}
