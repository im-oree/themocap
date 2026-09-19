import { beforeEach, describe, expect, it } from 'vitest';

import { MasterClock, RateMeter } from '../../src/lib/clock/masterClock';

/** Controllable stand-in for performance.now(), in milliseconds. */
function fakeNow() {
  let ms = 0;
  return {
    now: () => ms,
    advance: (deltaMs: number) => {
      ms += deltaMs;
    },
    set: (value: number) => {
      ms = value;
    },
  };
}

describe('MasterClock — wall source', () => {
  let time: ReturnType<typeof fakeNow>;
  let clock: MasterClock;

  beforeEach(() => {
    time = fakeNow();
    clock = new MasterClock({ source: 'wall', nowMs: time.now });
  });

  it('starts stopped at zero with no frames issued', () => {
    expect(clock.isRunning).toBe(false);
    expect(clock.now()).toBe(0);
    expect(clock.frameIndex).toBe(-1);
  });

  it('does not advance before start', () => {
    time.advance(500);
    expect(clock.now()).toBe(0);
  });

  it('advances while running', () => {
    clock.start();
    time.advance(250);
    expect(clock.now()).toBeCloseTo(0.25, 6);
    time.advance(750);
    expect(clock.now()).toBeCloseTo(1.0, 6);
  });

  it('is idempotent on repeated start', () => {
    clock.start();
    time.advance(100);
    clock.start();
    time.advance(100);
    expect(clock.now()).toBeCloseTo(0.2, 6);
  });

  it('holds its value while paused and resumes without a jump', () => {
    clock.start();
    time.advance(400);
    clock.pause();
    expect(clock.now()).toBeCloseTo(0.4, 6);

    // A long pause must not be counted as elapsed time.
    time.advance(5000);
    expect(clock.now()).toBeCloseTo(0.4, 6);

    clock.start();
    time.advance(100);
    expect(clock.now()).toBeCloseTo(0.5, 6);
  });

  it('accumulates across several pause/resume cycles', () => {
    clock.start();
    for (let i = 0; i < 4; i += 1) {
      time.advance(100);
      clock.pause();
      time.advance(1000);
      clock.start();
    }
    expect(clock.now()).toBeCloseTo(0.4, 6);
  });

  it('rewinds everything on reset', () => {
    clock.start();
    time.advance(300);
    clock.tick();
    clock.reset();
    expect(clock.now()).toBe(0);
    expect(clock.frameIndex).toBe(-1);
    expect(clock.isRunning).toBe(false);
  });
});

describe('MasterClock — ticks', () => {
  it('issues frame indices from 0 with dt 0 on the first tick', () => {
    const time = fakeNow();
    const clock = new MasterClock({ nowMs: time.now });
    clock.start();
    time.advance(100);

    const first = clock.tick();
    expect(first.frameIndex).toBe(0);
    expect(first.dt).toBe(0);
    expect(first.t).toBeCloseTo(0.1, 6);
  });

  it('reports the gap between ticks', () => {
    const time = fakeNow();
    const clock = new MasterClock({ nowMs: time.now });
    clock.start();
    clock.tick();
    time.advance(33);
    const second = clock.tick();
    expect(second.frameIndex).toBe(1);
    expect(second.dt).toBeCloseTo(0.033, 6);
  });

  it('never reuses or skips a frame index', () => {
    const time = fakeNow();
    const clock = new MasterClock({ nowMs: time.now });
    clock.start();
    const seen: number[] = [];
    for (let i = 0; i < 100; i += 1) {
      time.advance(16);
      seen.push(clock.tick().frameIndex);
    }
    expect(seen).toEqual(Array.from({ length: 100 }, (_, i) => i));
  });

  it('keeps counting frames while paused, but with dt 0', () => {
    const time = fakeNow();
    const clock = new MasterClock({ nowMs: time.now });
    clock.start();
    time.advance(100);
    clock.tick();
    clock.pause();
    time.advance(1000);
    const tick = clock.tick();
    expect(tick.frameIndex).toBe(1);
    expect(tick.dt).toBe(0);
  });

  it('peek does not consume a frame index', () => {
    const time = fakeNow();
    const clock = new MasterClock({ nowMs: time.now });
    clock.start();
    clock.tick();
    time.advance(20);
    const a = clock.peek();
    const b = clock.peek();
    expect(a.frameIndex).toBe(b.frameIndex);
    expect(a.frameIndex).toBe(0);
    expect(clock.tick().frameIndex).toBe(1);
  });
});

describe('MasterClock — media source', () => {
  it('follows the video element rather than wall time', () => {
    const time = fakeNow();
    const clock = new MasterClock({ source: 'media', nowMs: time.now });
    clock.start();

    time.advance(5000); // wall time marches on...
    expect(clock.now()).toBe(0); // ...media time has not been reported yet.

    clock.setMediaTime(2.5);
    expect(clock.now()).toBe(2.5);
  });

  it('allows backward seeks without emitting a negative dt', () => {
    const clock = new MasterClock({ source: 'media' });
    clock.start();
    clock.setMediaTime(10);
    clock.tick();
    clock.setMediaTime(2); // user scrubs back
    const tick = clock.tick();
    expect(tick.t).toBe(2);
    expect(tick.dt).toBe(0);
    // Frame index stays monotonic even though time went backwards — this is what
    // the ring buffers key on.
    expect(tick.frameIndex).toBe(1);
  });

  it('resets when the source changes, so the first frame is not mistimed', () => {
    const time = fakeNow();
    const clock = new MasterClock({ source: 'wall', nowMs: time.now });
    clock.start();
    time.advance(1000);
    clock.tick();
    expect(clock.frameIndex).toBe(0);

    clock.setSource('media');
    expect(clock.clockSource).toBe('media');
    expect(clock.now()).toBe(0);
    expect(clock.frameIndex).toBe(-1);
    expect(clock.isRunning).toBe(false);
  });

  it('ignores a no-op source change', () => {
    const clock = new MasterClock({ source: 'wall' });
    clock.start();
    clock.tick();
    clock.setSource('wall');
    expect(clock.frameIndex).toBe(0);
    expect(clock.isRunning).toBe(true);
  });
});

describe('RateMeter', () => {
  it('reports 0 until it has two samples', () => {
    const meter = new RateMeter();
    expect(meter.fps).toBe(0);
    meter.sample(0);
    expect(meter.fps).toBe(0);
  });

  it('measures a steady rate', () => {
    const meter = new RateMeter(30);
    for (let i = 0; i < 30; i += 1) meter.sample(i / 60);
    expect(meter.fps).toBeCloseTo(60, 6);
  });

  it('measures a slow rate', () => {
    const meter = new RateMeter(30);
    for (let i = 0; i < 10; i += 1) meter.sample(i / 10);
    expect(meter.fps).toBeCloseTo(10, 6);
  });

  it('only keeps the window, so old samples stop dragging the estimate', () => {
    const meter = new RateMeter(5);
    // Ten very slow frames, then five fast ones.
    for (let i = 0; i < 10; i += 1) meter.sample(i);
    expect(meter.fps).toBeCloseTo(1, 6);
    let t = 10;
    for (let i = 0; i < 5; i += 1) {
      t += 1 / 60;
      meter.sample(t);
    }
    expect(meter.fps).toBeCloseTo(60, 1);
    expect(meter.sampleCount).toBe(5);
  });

  it('survives duplicate timestamps without dividing by zero', () => {
    const meter = new RateMeter();
    meter.sample(1);
    meter.sample(1);
    expect(meter.fps).toBe(0);
    expect(Number.isFinite(meter.fps)).toBe(true);
  });

  it('clears on reset', () => {
    const meter = new RateMeter();
    meter.sample(0);
    meter.sample(1);
    meter.reset();
    expect(meter.sampleCount).toBe(0);
    expect(meter.fps).toBe(0);
  });
});
