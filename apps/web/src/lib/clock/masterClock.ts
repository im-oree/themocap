/**
 * The master clock: the single source of truth for "when are we?" across the
 * camera, the video element, the inference pipeline, the recorder, and the rig.
 *
 * # Why this exists
 *
 * Every subsystem has its own notion of time and none of them agree:
 *
 * - `performance.now()` is wall time and keeps running when we pause.
 * - `HTMLVideoElement.currentTime` is media time and jumps on seek.
 * - `MediaRecorder` timestamps are relative to when recording started.
 * - Worker threads each have their own `performance.timeOrigin`.
 *
 * If each consumer picks its own, the 2D overlay drifts from the video, the rig
 * lags the overlay, and a recorded take's poses do not line up with its video.
 * So there is exactly one clock, it is advanced by one owner, and everything else
 * *reads* it. Nothing else may call `performance.now()` for pipeline timing.
 *
 * # Two sources, one interface
 *
 * - **Live camera**: time is free-running wall time from the moment we started.
 *   Frames arrive when they arrive.
 * - **Video file**: time is the video element's `currentTime`, which the *user*
 *   controls by seeking. The clock follows it rather than leading it.
 *
 * `MasterClock` hides that difference behind `now()` and a monotonic
 * `frameIndex`, so the capture worker and recorder are identical in both modes.
 */

/** Which timebase the clock is following. */
export type ClockSource = 'wall' | 'media';

export interface ClockTick {
  /** Presentation time in seconds since the clock started. Monotonic while running. */
  t: number;
  /** Monotonic frame counter, incremented once per tick. Never reused. */
  frameIndex: number;
  /** Seconds since the previous tick. 0 on the first tick. */
  dt: number;
}

export interface MasterClockOptions {
  source?: ClockSource;
  /** Injectable for tests; defaults to `performance.now()` in milliseconds. */
  nowMs?: () => number;
}

/**
 * A clock that can be started, paused, resumed and reset, and that hands out
 * monotonically increasing frame indices.
 *
 * Deliberately *not* a scheduler — it does not own a `requestAnimationFrame` loop
 * or a timer. Callers tick it. That keeps it testable with no fake timers and lets
 * the capture loop, which knows when a real frame actually arrived, drive it.
 */
export class MasterClock {
  private readonly nowMs: () => number;
  private source: ClockSource;

  /** Wall-clock ms at which the current running span began. */
  private spanStartMs = 0;
  /** Accumulated running time in ms from all previous spans. */
  private accumulatedMs = 0;
  /** Media time in seconds, when following a video element. */
  private mediaTime = 0;

  private running = false;
  private frameIndexValue = -1;
  private lastT = 0;

  constructor(options: MasterClockOptions = {}) {
    this.source = options.source ?? 'wall';
    this.nowMs = options.nowMs ?? (() => performance.now());
  }

  get isRunning(): boolean {
    return this.running;
  }

  get frameIndex(): number {
    return this.frameIndexValue;
  }

  get clockSource(): ClockSource {
    return this.source;
  }

  /**
   * Switches timebase. Resets the clock, because carrying a wall-clock elapsed
   * time into media time (or vice versa) would produce a nonsense timestamp for
   * the first frame after the switch — and that frame is the one a recording
   * would be anchored to.
   */
  setSource(source: ClockSource): void {
    if (source === this.source) return;
    this.source = source;
    this.reset();
  }

  /** Starts (or resumes) the clock. Idempotent. */
  start(): void {
    if (this.running) return;
    this.spanStartMs = this.nowMs();
    this.running = true;
  }

  /**
   * Pauses. Elapsed time stops accruing; `now()` holds its last value, so a paused
   * preview keeps showing a coherent timestamp rather than snapping to zero.
   */
  pause(): void {
    if (!this.running) return;
    this.accumulatedMs += this.nowMs() - this.spanStartMs;
    this.running = false;
  }

  /** Stops and rewinds to zero, including the frame counter. */
  reset(): void {
    this.running = false;
    this.accumulatedMs = 0;
    this.spanStartMs = 0;
    this.mediaTime = 0;
    this.frameIndexValue = -1;
    this.lastT = 0;
  }

  /**
   * Reports the video element's current time. Only meaningful in `'media'` mode.
   *
   * Seeking backwards is legal and expected, so `now()` is NOT monotonic in media
   * mode — but `frameIndex` still is, which is what the ring buffers key on.
   */
  setMediaTime(seconds: number): void {
    this.mediaTime = seconds;
  }

  /** Current presentation time in seconds. */
  now(): number {
    if (this.source === 'media') return this.mediaTime;
    const spanMs = this.running ? this.nowMs() - this.spanStartMs : 0;
    return (this.accumulatedMs + spanMs) / 1000;
  }

  /**
   * Advances the frame counter and returns the tick. Call once per captured frame.
   *
   * `dt` is clamped to be non-negative so that a backward media seek cannot emit a
   * negative delta into a filter's time base, which would make the One Euro
   * filter's alpha blow up.
   */
  tick(): ClockTick {
    const t = this.now();
    this.frameIndexValue += 1;
    const dt = this.frameIndexValue === 0 ? 0 : Math.max(0, t - this.lastT);
    this.lastT = t;
    return { t, frameIndex: this.frameIndexValue, dt };
  }

  /** The tick that `tick()` would return, without consuming a frame index. */
  peek(): ClockTick {
    const t = this.now();
    return {
      t,
      frameIndex: this.frameIndexValue,
      dt: this.frameIndexValue < 0 ? 0 : Math.max(0, t - this.lastT),
    };
  }
}

/**
 * Rolling frame-rate estimate over a fixed window.
 *
 * Used by the perf HUD and by the §17 acceptance check (">= 24fps live
 * end-to-end"). A window rather than an instantaneous 1/dt because single-frame
 * deltas are far too noisy to display or to assert on.
 */
export class RateMeter {
  private readonly times: number[] = [];

  constructor(private readonly windowSize = 30) {}

  /** Records a sample at time `t` (seconds). */
  sample(t: number): void {
    this.times.push(t);
    if (this.times.length > this.windowSize) this.times.shift();
  }

  /** Frames per second over the window, or 0 with fewer than two samples. */
  get fps(): number {
    if (this.times.length < 2) return 0;
    const span = this.times[this.times.length - 1]! - this.times[0]!;
    if (span <= 0) return 0;
    return (this.times.length - 1) / span;
  }

  get sampleCount(): number {
    return this.times.length;
  }

  reset(): void {
    this.times.length = 0;
  }
}
