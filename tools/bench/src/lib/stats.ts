/** Frame-time statistics shared by the runner and the results table. */

export interface FrameStats {
  frames: number;
  avgFps: number;
  p10FrameMs: number;
  p50FrameMs: number;
  p90FrameMs: number;
  totalMs: number;
}

export function percentile(sorted: number[], q: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.round((sorted.length - 1) * q)));
  return sorted[idx] ?? 0;
}

export function summarize(frameTimesMs: number[]): FrameStats {
  if (frameTimesMs.length === 0) {
    return { frames: 0, avgFps: 0, p10FrameMs: 0, p50FrameMs: 0, p90FrameMs: 0, totalMs: 0 };
  }
  const sorted = [...frameTimesMs].sort((a, b) => a - b);
  const totalMs = frameTimesMs.reduce((a, b) => a + b, 0);
  return {
    frames: frameTimesMs.length,
    avgFps: 1000 / (totalMs / frameTimesMs.length),
    p10FrameMs: percentile(sorted, 0.1),
    p50FrameMs: percentile(sorted, 0.5),
    p90FrameMs: percentile(sorted, 0.9),
    totalMs,
  };
}

export interface AgreementStats {
  comparedFrames: number;
  comparedKeypoints: number;
  meanPixelDistance: number;
  maxPixelDistance: number;
}

/**
 * Mean/max per-keypoint distance between two runs' outputs.
 * Inputs are flat [x, y, ...] pairs per frame.
 */
export function compareKeypoints(a: Float32Array[], b: Float32Array[]): AgreementStats {
  const frames = Math.min(a.length, b.length);
  let sum = 0;
  let max = 0;
  let count = 0;

  for (let f = 0; f < frames; f++) {
    const av = a[f]!;
    const bv = b[f]!;
    const pairs = Math.min(av.length, bv.length) >> 1;
    for (let k = 0; k < pairs; k++) {
      const dx = (av[k * 2] ?? 0) - (bv[k * 2] ?? 0);
      const dy = (av[k * 2 + 1] ?? 0) - (bv[k * 2 + 1] ?? 0);
      const d = Math.hypot(dx, dy);
      sum += d;
      if (d > max) max = d;
      count++;
    }
  }

  return {
    comparedFrames: frames,
    comparedKeypoints: count,
    meanPixelDistance: count > 0 ? sum / count : 0,
    maxPixelDistance: max,
  };
}

interface MemoryInfo {
  usedJSHeapSize: number;
}

/** Chrome-only, approximate. Null elsewhere — never present it as precise. */
export function readHeapBytes(): number | null {
  const mem = (performance as Performance & { memory?: MemoryInfo }).memory;
  return mem ? mem.usedJSHeapSize : null;
}
