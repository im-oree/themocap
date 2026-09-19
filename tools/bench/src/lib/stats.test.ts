import { describe, expect, it } from 'vitest';
import { compareKeypoints, percentile, summarize } from './stats';
import { imageDataToTensor, inputSize } from './preprocess';
import { PRESETS, resolveModels } from './presets';

describe('frame statistics', () => {
  it('computes FPS and percentiles from frame times', () => {
    const stats = summarize([10, 10, 10, 10]);
    expect(stats.frames).toBe(4);
    expect(stats.avgFps).toBeCloseTo(100, 5);
    expect(stats.totalMs).toBe(40);
  });

  it('orders p10 <= p50 <= p90', () => {
    const times = Array.from({ length: 100 }, (_, i) => i + 1);
    const stats = summarize(times);
    expect(stats.p10FrameMs).toBeLessThanOrEqual(stats.p50FrameMs);
    expect(stats.p50FrameMs).toBeLessThanOrEqual(stats.p90FrameMs);
    expect(stats.p90FrameMs).toBeGreaterThan(80);
  });

  it('handles the empty case without NaN', () => {
    const stats = summarize([]);
    expect(stats.frames).toBe(0);
    expect(stats.avgFps).toBe(0);
    expect(percentile([], 0.5)).toBe(0);
  });
});

describe('WASM/WebGPU agreement', () => {
  it('reports zero distance for identical outputs', () => {
    const a = [new Float32Array([1, 2, 3, 4])];
    const result = compareKeypoints(a, [new Float32Array([1, 2, 3, 4])]);
    expect(result.meanPixelDistance).toBe(0);
    expect(result.maxPixelDistance).toBe(0);
    expect(result.comparedKeypoints).toBe(2);
  });

  it('measures per-keypoint pixel distance', () => {
    // Keypoint 0 moves (3,4) => distance 5; keypoint 1 is unchanged.
    const a = [new Float32Array([0, 0, 10, 10])];
    const b = [new Float32Array([3, 4, 10, 10])];
    const result = compareKeypoints(a, b);
    expect(result.maxPixelDistance).toBeCloseTo(5, 6);
    expect(result.meanPixelDistance).toBeCloseTo(2.5, 6);
  });

  it('only compares frames present in both runs', () => {
    const a = [new Float32Array([0, 0]), new Float32Array([0, 0])];
    const b = [new Float32Array([0, 0])];
    expect(compareKeypoints(a, b).comparedFrames).toBe(1);
  });
});

describe('preprocessing (bench-only)', () => {
  const entry = {
    inputShape: [1, 3, 2, 2],
    preprocessing: {
      mean: [0, 0, 0] as [number, number, number],
      std: [255, 255, 255] as [number, number, number],
      layout: 'nchw' as const,
      colorOrder: 'rgb' as const,
      letterbox: true,
    },
  };

  it('derives input size from the declared shape and layout', () => {
    expect(inputSize(entry)).toEqual({ width: 2, height: 2 });
    expect(
      inputSize({
        inputShape: [1, 256, 192, 3],
        preprocessing: { layout: 'nhwc', colorOrder: 'rgb', letterbox: true },
      }),
    ).toEqual({ width: 192, height: 256 });
  });

  it('produces a planar NCHW tensor with normalization applied', () => {
    const data = new Uint8ClampedArray(2 * 2 * 4).fill(0);
    // One white pixel at index 0.
    data[0] = 255;
    data[1] = 255;
    data[2] = 255;
    data[3] = 255;
    const tensor = imageDataToTensor({ width: 2, height: 2, data } as ImageData, entry);

    expect(tensor.dims).toEqual([1, 3, 2, 2]);
    expect(tensor.data.length).toBe(12);
    expect((tensor.data as Float32Array)[0]).toBeCloseTo(1, 6);
    expect((tensor.data as Float32Array)[4]).toBeCloseTo(1, 6); // green plane
    expect((tensor.data as Float32Array)[1]).toBeCloseTo(0, 6);
  });

  it('swaps channels for BGR models', () => {
    const data = new Uint8ClampedArray(4);
    data[0] = 255; // R
    data[1] = 0;
    data[2] = 0;
    data[3] = 255;
    const tensor = imageDataToTensor({ width: 1, height: 1, data } as ImageData, {
      inputShape: [1, 3, 1, 1],
      preprocessing: { layout: 'nchw', colorOrder: 'bgr', letterbox: false },
    });
    // With BGR order the red value must land in the LAST plane.
    expect((tensor.data as Float32Array)[0]).toBe(0);
    expect((tensor.data as Float32Array)[2]).toBe(255);
  });
});

describe('pipeline presets', () => {
  it('every preset resolves to real manifest entries', () => {
    for (const preset of PRESETS) {
      const models = resolveModels(preset.modelIds);
      expect(models).toHaveLength(preset.modelIds.length);
    }
  });

  it('covers both the live and refine paths required by Document 1', () => {
    const ids = PRESETS.map((p) => p.id);
    expect(ids).toContain('live');
    expect(ids).toContain('refine');

    const live = PRESETS.find((p) => p.id === 'live')!;
    const tasks = resolveModels(live.modelIds).map((m) => m.task);
    expect(tasks).toEqual(['person-detector', 'pose-2d', 'lift-3d']);
  });

  it('throws loudly on an unknown model id', () => {
    expect(() => resolveModels(['does-not-exist'])).toThrow(/unknown model id/);
  });
});
