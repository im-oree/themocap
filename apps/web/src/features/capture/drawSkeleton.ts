/**
 * Draws a 2D keypoint skeleton onto the overlay canvas.
 *
 * Pure canvas rendering, called directly from the capture callback rather than
 * through React: at 30fps, routing this through state would be 30 reconciliation
 * passes a second to redraw something React cannot see.
 */

import type { Keypoint } from './movenet';

/** COCO-17 bone pairs, as index pairs into the keypoint array. */
export const COCO17_EDGES: readonly (readonly [number, number])[] = [
  // Face
  [0, 1],
  [0, 2],
  [1, 3],
  [2, 4],
  // Shoulders and arms
  [5, 6],
  [5, 7],
  [7, 9],
  [6, 8],
  [8, 10],
  // Torso
  [5, 11],
  [6, 12],
  [11, 12],
  // Legs
  [11, 13],
  [13, 15],
  [12, 14],
  [14, 16],
];

/**
 * Confidence below which a keypoint is not drawn.
 *
 * Drawing low-confidence points is actively misleading: an occluded wrist gets
 * predicted somewhere arbitrary, and a bone drawn to it reads as real tracking.
 * Hiding it makes the gap visible, which is the honest signal.
 */
export const MIN_DRAW_SCORE = 0.3;

export interface DrawOptions {
  minScore?: number;
  jointRadius?: number;
  lineWidth?: number;
  color?: string;
}

export function drawSkeleton(
  ctx: CanvasRenderingContext2D,
  keypoints: readonly Keypoint[],
  width: number,
  height: number,
  edges: readonly (readonly [number, number])[] = COCO17_EDGES,
  options: DrawOptions = {},
): void {
  const {
    minScore = MIN_DRAW_SCORE,
    jointRadius = 3,
    lineWidth = 2,
    color = '#34d399',
  } = options;

  if (width === 0 || height === 0 || keypoints.length === 0) return;

  ctx.save();
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = lineWidth;
  ctx.lineCap = 'round';

  for (const [a, b] of edges) {
    const from = keypoints[a];
    const to = keypoints[b];
    // Both ends must be confident: one good endpoint and one guess produces a
    // bone pointing at nothing.
    if (!from || !to || from.score < minScore || to.score < minScore) continue;
    ctx.beginPath();
    ctx.moveTo(from.x * width, from.y * height);
    ctx.lineTo(to.x * width, to.y * height);
    ctx.stroke();
  }

  for (const kp of keypoints) {
    if (kp.score < minScore) continue;
    ctx.beginPath();
    ctx.arc(kp.x * width, kp.y * height, jointRadius, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.restore();
}

/**
 * The rect a source occupies inside a box under CSS `object-fit: contain`.
 *
 * Needed because the overlay canvas spans the whole panel while the video is
 * letterboxed inside it; without this the skeleton drifts off the body whenever
 * the panel's aspect ratio differs from the camera's.
 */
export function containRect(
  sourceWidth: number,
  sourceHeight: number,
  boxWidth: number,
  boxHeight: number,
): { x: number; y: number; width: number; height: number } | null {
  if (sourceWidth <= 0 || sourceHeight <= 0 || boxWidth <= 0 || boxHeight <= 0) return null;
  const scale = Math.min(boxWidth / sourceWidth, boxHeight / sourceHeight);
  const width = sourceWidth * scale;
  const height = sourceHeight * scale;
  return { x: (boxWidth - width) / 2, y: (boxHeight - height) / 2, width, height };
}
