import type { ModelManifestEntry } from '@wms/models';
import type { TensorView } from '@wms/inference/types';

/**
 * BENCH-ONLY preprocessing, written in TypeScript with typed arrays.
 *
 * EXEMPTION (recorded in docs/decisions.md): the master spec's "no JS fallback for
 * compute kernels" rule applies to shipped product code. tools/bench is internal
 * tooling and is explicitly exempt so the harness can exist before the Rust
 * preprocessing kernels land. Production preprocessing MUST move to Rust/WASM in
 * Document 2. Do not copy this file into apps/web.
 */

export interface LetterboxInfo {
  scale: number;
  padX: number;
  padY: number;
}

/** Resize-with-aspect (letterbox) onto a target canvas, returning the mapping. */
export function letterboxToCanvas(
  source: CanvasImageSource,
  sourceWidth: number,
  sourceHeight: number,
  targetWidth: number,
  targetHeight: number,
  ctx: CanvasRenderingContext2D,
): LetterboxInfo {
  const scale = Math.min(targetWidth / sourceWidth, targetHeight / sourceHeight);
  const drawW = Math.round(sourceWidth * scale);
  const drawH = Math.round(sourceHeight * scale);
  const padX = Math.floor((targetWidth - drawW) / 2);
  const padY = Math.floor((targetHeight - drawH) / 2);

  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, targetWidth, targetHeight);
  ctx.drawImage(source, 0, 0, sourceWidth, sourceHeight, padX, padY, drawW, drawH);

  return { scale, padX, padY };
}

/** Converts RGBA pixel data into the model's expected tensor layout. */
export function imageDataToTensor(
  image: ImageData,
  entry: Pick<ModelManifestEntry, 'preprocessing' | 'inputShape'>,
): TensorView {
  const { width, height, data } = image;
  const pre = entry.preprocessing;
  const layout = pre?.layout ?? 'nchw';
  const bgr = pre?.colorOrder === 'bgr';
  const mean = pre?.mean ?? [0, 0, 0];
  const std = pre?.std ?? [1, 1, 1];

  const out = new Float32Array(width * height * 3);
  const planeSize = width * height;

  for (let i = 0, p = 0; i < planeSize; i++, p += 4) {
    const r = data[p] ?? 0;
    const g = data[p + 1] ?? 0;
    const b = data[p + 2] ?? 0;
    const c0 = ((bgr ? b : r) - (mean[0] ?? 0)) / (std[0] ?? 1);
    const c1 = (g - (mean[1] ?? 0)) / (std[1] ?? 1);
    const c2 = ((bgr ? r : b) - (mean[2] ?? 0)) / (std[2] ?? 1);

    if (layout === 'nchw') {
      out[i] = c0;
      out[planeSize + i] = c1;
      out[2 * planeSize + i] = c2;
    } else {
      out[i * 3] = c0;
      out[i * 3 + 1] = c1;
      out[i * 3 + 2] = c2;
    }
  }

  return {
    data: out,
    dims: layout === 'nchw' ? [1, 3, height, width] : [1, height, width, 3],
    type: 'float32',
  };
}

/** Input height/width from a manifest entry's declared shape. */
export function inputSize(entry: Pick<ModelManifestEntry, 'inputShape' | 'preprocessing'>): {
  width: number;
  height: number;
} {
  const shape = entry.inputShape;
  if ((entry.preprocessing?.layout ?? 'nchw') === 'nchw') {
    return { height: shape[2] ?? 256, width: shape[3] ?? 256 };
  }
  return { height: shape[1] ?? 256, width: shape[2] ?? 256 };
}
