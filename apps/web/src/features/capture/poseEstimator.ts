/**
 * Runs a 2D pose model over video frames.
 *
 * Sits between the raw `<video>` element and the rest of the pipeline: it owns
 * the offscreen canvas used for letterboxing, the ONNX session, and the
 * input/output tensor buffers. Callers hand it a frame and get keypoints back.
 *
 * Buffers are allocated once and reused. At 30fps a fresh 192x192x3 input array
 * per frame is ~110KB of garbage per frame, or 3.3MB/s of allocation churn that
 * the GC then has to walk — enough to cause visible hitching in the render loop.
 */

import type { InferenceBackend, ModelHandle, ModelSpec } from '@wms/inference/types';

import {
  MOVENET_INPUT_SIZE,
  computeLetterbox,
  decodeMoveNetOutput,
  rgbaToUint8Nhwc,
  type Keypoint,
  type LetterboxTransform,
} from './movenet';

/** Anything with intrinsic dimensions that a canvas can draw. */
export type FrameSource = CanvasImageSource & {
  readonly videoWidth?: number;
  readonly videoHeight?: number;
  readonly naturalWidth?: number;
  readonly naturalHeight?: number;
};

export interface PoseEstimatorOptions {
  backend: InferenceBackend;
  spec: ModelSpec;
  inputSize?: number;
}

export interface PoseResult {
  keypoints: Keypoint[];
  /** Wall-clock milliseconds spent inside `session.run`. */
  inferenceMs: number;
  /** Mean confidence, a cheap "is anyone actually there" signal. */
  meanScore: number;
}

/** Reads a source's intrinsic size, whatever kind of element it is. */
export function sourceDimensions(source: FrameSource): { width: number; height: number } {
  const width = source.videoWidth ?? source.naturalWidth ?? (source as { width?: number }).width ?? 0;
  const height =
    source.videoHeight ?? source.naturalHeight ?? (source as { height?: number }).height ?? 0;
  return { width: Number(width) || 0, height: Number(height) || 0 };
}

export class PoseEstimator {
  private handle: ModelHandle | null = null;
  private canvas: OffscreenCanvas | HTMLCanvasElement | null = null;
  private ctx: OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D | null = null;
  private inputBuffer: Uint8Array;
  private readonly inputSize: number;
  private disposed = false;

  constructor(private readonly options: PoseEstimatorOptions) {
    this.inputSize = options.inputSize ?? MOVENET_INPUT_SIZE;
    this.inputBuffer = new Uint8Array(this.inputSize * this.inputSize * 3);
  }

  get ready(): boolean {
    return this.handle !== null;
  }

  /** Loads the model. Safe to call twice; the second call is a no-op. */
  async load(): Promise<void> {
    if (this.handle || this.disposed) return;
    await this.options.backend.init();
    this.handle = await this.options.backend.load(this.options.spec);
  }

  private ensureCanvas() {
    if (this.ctx) return;
    const size = this.inputSize;
    // OffscreenCanvas keeps this usable from a worker; fall back on the main
    // thread for browsers (and jsdom) that lack it.
    if (typeof OffscreenCanvas !== 'undefined') {
      this.canvas = new OffscreenCanvas(size, size);
    } else {
      const el = document.createElement('canvas');
      el.width = size;
      el.height = size;
      this.canvas = el;
    }
    // `willReadFrequently` matters: without it browsers may keep the canvas on
    // the GPU, making the per-frame getImageData readback dramatically slower.
    this.ctx = this.canvas.getContext('2d', {
      willReadFrequently: true,
    }) as OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D | null;
    if (!this.ctx) throw new Error('Could not acquire a 2D context for pose preprocessing');
  }

  /**
   * Draws a frame into the square model input, preserving aspect ratio.
   *
   * Returns the transform so decoding can undo the letterbox; without it the
   * resulting pose is offset and stretched relative to the video.
   */
  private letterbox(source: FrameSource): LetterboxTransform | null {
    const { width, height } = sourceDimensions(source);
    if (width === 0 || height === 0) return null;

    this.ensureCanvas();
    const ctx = this.ctx!;
    const size = this.inputSize;
    const transform = computeLetterbox(width, height, size);

    // Black bars rather than stale pixels from the previous frame: leftover
    // content in the padding reads as image data to the model.
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, size, size);
    ctx.drawImage(
      source,
      transform.padX,
      transform.padY,
      width * transform.scale,
      height * transform.scale,
    );
    return transform;
  }

  /** Runs one frame. Returns null when the source has no usable dimensions. */
  async estimate(source: FrameSource): Promise<PoseResult | null> {
    if (!this.handle) throw new Error('PoseEstimator.load() must be awaited before estimate()');

    const transform = this.letterbox(source);
    if (!transform) return null;

    const size = this.inputSize;
    const image = this.ctx!.getImageData(0, 0, size, size);
    const packed = rgbaToUint8Nhwc(image.data);
    this.inputBuffer.set(packed);

    const started = performance.now();
    const outputs = await this.handle.run({
      [this.options.spec.inputName]: {
        data: this.inputBuffer,
        dims: [1, size, size, 3],
        type: 'uint8',
      },
    });
    const inferenceMs = performance.now() - started;

    const outputName = this.options.spec.outputNames[0] ?? Object.keys(outputs)[0]!;
    const tensor = outputs[outputName];
    if (!tensor) {
      throw new Error(
        `Model produced no "${outputName}" output; got [${Object.keys(outputs).join(', ')}]`,
      );
    }

    const keypoints = decodeMoveNetOutput(tensor.data as Float32Array, transform, size);
    const meanScore =
      keypoints.reduce((sum, kp) => sum + kp.score, 0) / (keypoints.length || 1);

    return { keypoints, inferenceMs, meanScore };
  }

  async dispose(): Promise<void> {
    this.disposed = true;
    const handle = this.handle;
    this.handle = null;
    this.ctx = null;
    this.canvas = null;
    // Releasing the ORT session frees its wasm heap; dropping the reference
    // alone leaves it allocated for the lifetime of the page.
    if (handle) await handle.dispose();
  }
}
