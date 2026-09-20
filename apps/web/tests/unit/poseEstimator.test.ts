/**
 * PoseEstimator: the seam between a video frame and the model.
 *
 * Driven by a fake backend that records exactly what it was fed. That is the
 * point — the interesting failures here are contract violations (wrong dtype,
 * wrong layout, stale padding, per-frame allocation) that a real session would
 * accept silently while producing a subtly wrong skeleton.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { PoseEstimator, sourceDimensions } from '../../src/features/capture/poseEstimator';
import type { FrameSource } from '../../src/features/capture/poseEstimator';
import type { InferenceBackend, ModelSpec, TensorView } from '@wms/inference/types';

const SPEC: ModelSpec = {
  id: 'movenet-stub',
  url: '/models/movenet-singlepose-lightning.stub.onnx',
  sha256: 'a'.repeat(64),
  sizeBytes: 1203,
  precision: 'fp32',
  inputShape: [1, 192, 192, 3],
  inputName: 'input',
  outputNames: ['output_0'],
};

/** Records every tensor it is handed and replies with a fixed pose. */
function makeBackend(poseYXS: [number, number, number][] = [[0.25, 0.75, 0.9]]) {
  const feeds: Record<string, TensorView>[] = [];
  const output = new Float32Array(17 * 3);
  poseYXS.forEach(([y, x, s], i) => {
    output[i * 3] = y;
    output[i * 3 + 1] = x;
    output[i * 3 + 2] = s;
  });

  const dispose = vi.fn(async () => undefined);
  const init = vi.fn(async () => undefined);

  const backend: InferenceBackend = {
    id: 'ort-web-wasm',
    isAvailable: async () => true,
    init,
    load: async () => ({
      id: SPEC.id,
      backend: 'ort-web-wasm' as const,
      loadTimeMs: 1,
      inputNames: ['input'],
      outputNames: ['output_0'],
      run: async (f: Record<string, TensorView>) => {
        feeds.push(f);
        return { output_0: { data: output, dims: [1, 1, 17, 3], type: 'float32' as const } };
      },
      dispose,
    }),
  };
  return { backend, feeds, init, dispose };
}

/** A canvas-drawable stand-in with controllable intrinsic size. */
function fakeSource(width: number, height: number): FrameSource {
  return { videoWidth: width, videoHeight: height } as FrameSource;
}

let drawCalls: unknown[][] = [];
let fillCalls: unknown[][] = [];

beforeEach(() => {
  drawCalls = [];
  fillCalls = [];
  // jsdom has no 2D context; supply one that records the calls under test.
  const ctx = {
    fillStyle: '',
    fillRect: (...args: unknown[]) => fillCalls.push(args),
    drawImage: (...args: unknown[]) => drawCalls.push(args),
    getImageData: (_x: number, _y: number, w: number, h: number) => ({
      data: new Uint8ClampedArray(w * h * 4).fill(120),
      width: w,
      height: h,
    }),
  };
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(ctx as never);
  vi.stubGlobal('OffscreenCanvas', undefined);
});

describe('sourceDimensions', () => {
  it('reads video, image and plain canvas sizes', () => {
    expect(sourceDimensions({ videoWidth: 640, videoHeight: 480 } as FrameSource)).toEqual({
      width: 640,
      height: 480,
    });
    expect(sourceDimensions({ naturalWidth: 100, naturalHeight: 50 } as FrameSource)).toEqual({
      width: 100,
      height: 50,
    });
    expect(sourceDimensions({ width: 20, height: 10 } as unknown as FrameSource)).toEqual({
      width: 20,
      height: 10,
    });
  });

  it('reports zero for a source that has not loaded metadata', () => {
    expect(sourceDimensions({} as FrameSource)).toEqual({ width: 0, height: 0 });
  });
});

describe('lifecycle', () => {
  it('refuses to estimate before load()', async () => {
    const { backend } = makeBackend();
    const estimator = new PoseEstimator({ backend, spec: SPEC });
    await expect(estimator.estimate(fakeSource(640, 480))).rejects.toThrow(/load\(\)/);
  });

  it('initialises the backend exactly once across repeated loads', async () => {
    const { backend, init } = makeBackend();
    const estimator = new PoseEstimator({ backend, spec: SPEC });
    await estimator.load();
    await estimator.load();
    expect(init).toHaveBeenCalledTimes(1);
    expect(estimator.ready).toBe(true);
  });

  it('disposes the session so the wasm heap is released', async () => {
    const { backend, dispose } = makeBackend();
    const estimator = new PoseEstimator({ backend, spec: SPEC });
    await estimator.load();
    await estimator.dispose();
    expect(dispose).toHaveBeenCalledOnce();
    expect(estimator.ready).toBe(false);
  });

  it('load() after dispose() stays disposed', async () => {
    const { backend } = makeBackend();
    const estimator = new PoseEstimator({ backend, spec: SPEC });
    await estimator.dispose();
    await estimator.load();
    expect(estimator.ready).toBe(false);
  });
});

describe('preprocessing', () => {
  it('feeds a uint8 NHWC tensor of the declared shape', async () => {
    const { backend, feeds } = makeBackend();
    const estimator = new PoseEstimator({ backend, spec: SPEC });
    await estimator.load();
    await estimator.estimate(fakeSource(1280, 720));

    const tensor = feeds[0]!.input!;
    // MoveNet takes raw bytes, not normalised floats. fp32 here would be
    // accepted by the runtime and produce silent garbage.
    expect(tensor.type).toBe('uint8');
    expect(tensor.data).toBeInstanceOf(Uint8Array);
    expect(tensor.dims).toEqual([1, 192, 192, 3]);
    expect(tensor.data.length).toBe(192 * 192 * 3);
  });

  it('clears the canvas each frame so padding never holds stale pixels', async () => {
    const { backend } = makeBackend();
    const estimator = new PoseEstimator({ backend, spec: SPEC });
    await estimator.load();
    await estimator.estimate(fakeSource(1280, 720));

    // Leftover content in the letterbox bars reads as image data to the model.
    expect(fillCalls).toHaveLength(1);
    expect(fillCalls[0]).toEqual([0, 0, 192, 192]);
  });

  it('letterboxes rather than stretching a non-square frame', async () => {
    const { backend } = makeBackend();
    const estimator = new PoseEstimator({ backend, spec: SPEC });
    await estimator.load();
    await estimator.estimate(fakeSource(1280, 720));

    const [, dx, dy, dw, dh] = drawCalls[0] as [unknown, number, number, number, number];
    // 16:9 into a square: full width, vertically centred, aspect preserved.
    expect(dx).toBeCloseTo(0, 5);
    expect(dw).toBeCloseTo(192, 5);
    expect(dh).toBeCloseTo(192 * (720 / 1280), 5);
    expect(dy).toBeCloseTo((192 - dh) / 2, 5);
  });

  it('reuses one input buffer instead of allocating per frame', async () => {
    const { backend, feeds } = makeBackend();
    const estimator = new PoseEstimator({ backend, spec: SPEC });
    await estimator.load();
    await estimator.estimate(fakeSource(640, 480));
    await estimator.estimate(fakeSource(640, 480));

    // Identity, not equality: a fresh 110KB array per frame is 3.3MB/s of GC
    // churn at 30fps, which shows up as render-loop hitching.
    expect(feeds[0]!.input!.data).toBe(feeds[1]!.input!.data);
  });

  it('returns null for a source with no dimensions yet', async () => {
    const { backend, feeds } = makeBackend();
    const estimator = new PoseEstimator({ backend, spec: SPEC });
    await estimator.load();

    // A <video> polled before loadedmetadata reports 0x0; running the model on
    // it would waste a frame and produce NaN coordinates.
    expect(await estimator.estimate(fakeSource(0, 0))).toBeNull();
    expect(feeds).toHaveLength(0);
  });
});

describe('results', () => {
  it('decodes keypoints into source-normalised coordinates', async () => {
    const { backend } = makeBackend([[0.25, 0.75, 0.9]]);
    const estimator = new PoseEstimator({ backend, spec: SPEC });
    await estimator.load();

    const result = await estimator.estimate(fakeSource(192, 192));

    // (y=0.25, x=0.75) must not come back transposed.
    expect(result!.keypoints[0]!.x).toBeCloseTo(0.75, 5);
    expect(result!.keypoints[0]!.y).toBeCloseTo(0.25, 5);
    expect(result!.keypoints).toHaveLength(17);
  });

  it('reports mean confidence and a timing figure', async () => {
    const pose: [number, number, number][] = Array.from({ length: 17 }, () => [0.5, 0.5, 0.6]);
    const { backend } = makeBackend(pose);
    const estimator = new PoseEstimator({ backend, spec: SPEC });
    await estimator.load();

    const result = await estimator.estimate(fakeSource(640, 480));

    expect(result!.meanScore).toBeCloseTo(0.6, 5);
    expect(result!.inferenceMs).toBeGreaterThanOrEqual(0);
  });

  it('fails loudly when the model returns an unexpected output name', async () => {
    const { backend } = makeBackend();
    const estimator = new PoseEstimator({
      backend,
      spec: { ...SPEC, outputNames: ['not_there'] },
    });
    await estimator.load();

    // Better a clear error than silently decoding whatever happened to be first.
    await expect(estimator.estimate(fakeSource(640, 480))).rejects.toThrow(/no "not_there"/);
  });
});
