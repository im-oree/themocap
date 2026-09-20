/**
 * MoveNet SinglePose Lightning: preprocessing and output decoding.
 *
 * Chosen as the first live-path model because it is a single self-contained
 * 9.41 MB ONNX file needing no separate person detector, and it emits exactly
 * the COCO-17 topology `packages/skeleton` already defines.
 *
 * Two traps in this model's I/O contract, both of which produce plausible-looking
 * but wrong skeletons if missed, so both are encoded here rather than at the
 * call site:
 *
 *  1. **Input is `uint8` NHWC**, not the normalised fp32 NCHW that every
 *     RTMPose entry in the manifest uses. There is no mean/std normalisation —
 *     feeding it 0..1 floats yields garbage.
 *  2. **Output is `(y, x, score)` — Y FIRST.** Reading it as `(x, y)` gives a
 *     skeleton that is transposed about the diagonal, which on a roughly
 *     symmetric standing pose looks *almost* right, which is exactly what makes
 *     it dangerous.
 *
 * Kept pure and free of onnxruntime imports so the geometry can be tested
 * exhaustively without the weights file present.
 */

export const MOVENET_INPUT_SIZE = 192;
export const MOVENET_KEYPOINTS = 17;

/**
 * How the source frame was fitted into the square model input.
 *
 * Retained after preprocessing because decoding has to undo it: the model
 * reports coordinates in its own padded square, and mapping those back to the
 * original frame without the letterbox parameters produces a pose that is
 * offset and stretched relative to the video.
 */
export interface LetterboxTransform {
  /** Uniform scale applied to the source frame. */
  scale: number;
  /** Padding in model-input pixels on the left and top. */
  padX: number;
  padY: number;
  sourceWidth: number;
  sourceHeight: number;
}

export function computeLetterbox(
  sourceWidth: number,
  sourceHeight: number,
  target = MOVENET_INPUT_SIZE,
): LetterboxTransform {
  // Guard against a zero-sized frame: a <video> queried before metadata loads
  // reports 0x0, and dividing by it would poison every downstream coordinate
  // with NaN rather than failing loudly.
  if (sourceWidth <= 0 || sourceHeight <= 0) {
    return { scale: 1, padX: 0, padY: 0, sourceWidth: 0, sourceHeight: 0 };
  }
  const scale = Math.min(target / sourceWidth, target / sourceHeight);
  const drawnWidth = sourceWidth * scale;
  const drawnHeight = sourceHeight * scale;
  return {
    scale,
    // Centre the frame; aspect ratio is preserved, so at most one axis is padded.
    padX: (target - drawnWidth) / 2,
    padY: (target - drawnHeight) / 2,
    sourceWidth,
    sourceHeight,
  };
}

/**
 * One decoded keypoint.
 *
 * `x`/`y` are normalised to the **source frame** (0..1), not the model input,
 * so consumers never need to know a letterbox happened.
 */
export interface Keypoint {
  x: number;
  y: number;
  score: number;
}

/**
 * Decodes MoveNet's `[1, 1, 17, 3]` output into source-frame coordinates.
 *
 * The raw tensor is `(y, x, score)` normalised to the padded square input. This
 * reverses the letterbox so the result lines up with the displayed video.
 */
export function decodeMoveNetOutput(
  output: Float32Array,
  transform: LetterboxTransform,
  target = MOVENET_INPUT_SIZE,
): Keypoint[] {
  const keypoints: Keypoint[] = [];
  const { scale, padX, padY, sourceWidth, sourceHeight } = transform;

  for (let i = 0; i < MOVENET_KEYPOINTS; i += 1) {
    const base = i * 3;
    // Y FIRST — see the header note. This ordering is the model's, not a typo.
    const rawY = output[base] ?? 0;
    const rawX = output[base + 1] ?? 0;
    const score = output[base + 2] ?? 0;

    if (scale === 0 || sourceWidth === 0 || sourceHeight === 0) {
      keypoints.push({ x: 0, y: 0, score: 0 });
      continue;
    }

    // Normalised square -> model pixels -> strip padding -> source pixels.
    const sourceX = (rawX * target - padX) / scale;
    const sourceY = (rawY * target - padY) / scale;

    keypoints.push({
      x: sourceX / sourceWidth,
      y: sourceY / sourceHeight,
      score,
    });
  }

  return keypoints;
}

/**
 * Converts RGBA canvas pixels to the packed `uint8` RGB NHWC tensor the model
 * expects, dropping the alpha channel.
 */
export function rgbaToUint8Nhwc(rgba: Uint8ClampedArray | Uint8Array): Uint8Array {
  const pixelCount = rgba.length / 4;
  const out = new Uint8Array(pixelCount * 3);
  for (let i = 0; i < pixelCount; i += 1) {
    const src = i * 4;
    const dst = i * 3;
    out[dst] = rgba[src]!;
    out[dst + 1] = rgba[src + 1]!;
    out[dst + 2] = rgba[src + 2]!;
  }
  return out;
}

/**
 * Splits keypoints into the flat `kp2d` + `conf` arrays the WMOC writer and the
 * pose ring buffer both use, so the live and stored paths share one layout.
 */
export function keypointsToChannels(keypoints: readonly Keypoint[]): {
  kp2d: Float32Array;
  conf: Float32Array;
} {
  const kp2d = new Float32Array(keypoints.length * 2);
  const conf = new Float32Array(keypoints.length);
  for (let i = 0; i < keypoints.length; i += 1) {
    const kp = keypoints[i]!;
    kp2d[i * 2] = kp.x;
    kp2d[i * 2 + 1] = kp.y;
    conf[i] = kp.score;
  }
  return { kp2d, conf };
}
