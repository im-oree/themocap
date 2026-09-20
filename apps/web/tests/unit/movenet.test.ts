/**
 * MoveNet preprocessing and decoding geometry.
 *
 * These are the tests that matter most for a model I cannot run here: the
 * weights are absent, but the coordinate maths is fully determined by the
 * documented I/O contract and is exactly where a silent, plausible-looking
 * error would hide.
 */

import { describe, expect, it } from 'vitest';

import {
  MOVENET_INPUT_SIZE,
  computeLetterbox,
  decodeMoveNetOutput,
  keypointsToChannels,
  rgbaToUint8Nhwc,
} from '../../src/features/capture/movenet';
import { containRect } from '../../src/features/capture/drawSkeleton';

/** Builds a `[1,1,17,3]` output buffer from (y, x, score) triples. */
function buildOutput(points: [number, number, number][]): Float32Array {
  const out = new Float32Array(17 * 3);
  points.forEach(([y, x, score], i) => {
    out[i * 3] = y;
    out[i * 3 + 1] = x;
    out[i * 3 + 2] = score;
  });
  return out;
}

describe('computeLetterbox', () => {
  it('pads the short axis for a landscape frame', () => {
    const t = computeLetterbox(1280, 720);
    expect(t.scale).toBeCloseTo(192 / 1280, 10);
    // Width fills the square exactly, so only the height is padded.
    expect(t.padX).toBeCloseTo(0, 10);
    expect(t.padY).toBeCloseTo((192 - 720 * (192 / 1280)) / 2, 10);
  });

  it('pads the short axis for a portrait frame', () => {
    const t = computeLetterbox(720, 1280);
    expect(t.scale).toBeCloseTo(192 / 1280, 10);
    expect(t.padY).toBeCloseTo(0, 10);
    expect(t.padX).toBeGreaterThan(0);
  });

  it('needs no padding for a square frame', () => {
    const t = computeLetterbox(512, 512);
    expect(t.padX).toBeCloseTo(0, 10);
    expect(t.padY).toBeCloseTo(0, 10);
  });

  it('survives a zero-sized frame instead of producing NaN', () => {
    // A <video> queried before metadata loads reports 0x0; NaN coordinates
    // would silently poison every downstream frame.
    const t = computeLetterbox(0, 0);
    expect(Number.isFinite(t.scale)).toBe(true);
    const decoded = decodeMoveNetOutput(buildOutput([[0.5, 0.5, 0.9]]), t);
    expect(decoded[0]!.x).toBe(0);
    expect(decoded[0]!.score).toBe(0);
  });
});

describe('decodeMoveNetOutput', () => {
  it('reads the tensor as (y, x, score), not (x, y, score)', () => {
    // Deliberately asymmetric: top-left-ish point, far from the diagonal.
    const transform = computeLetterbox(192, 192);
    const output = buildOutput([[0.25, 0.75, 0.9]]);

    const [kp] = decodeMoveNetOutput(output, transform);

    // y=0.25, x=0.75 — swapping these yields (0.25, 0.75), which on a roughly
    // symmetric pose looks almost correct. That is what makes it dangerous.
    expect(kp!.x).toBeCloseTo(0.75, 6);
    expect(kp!.y).toBeCloseTo(0.25, 6);
    expect(kp!.score).toBeCloseTo(0.9, 6);
  });

  it('round-trips the centre of a letterboxed landscape frame', () => {
    const transform = computeLetterbox(1280, 720);
    // Dead centre of the padded square maps to dead centre of the source.
    const [kp] = decodeMoveNetOutput(buildOutput([[0.5, 0.5, 1]]), transform);

    expect(kp!.x).toBeCloseTo(0.5, 6);
    expect(kp!.y).toBeCloseTo(0.5, 6);
  });

  it('maps the frame corners to 0 and 1 after removing padding', () => {
    const width = 1280;
    const height = 720;
    const transform = computeLetterbox(width, height);
    const scale = transform.scale;

    // Top-left of the *drawn image*, in normalised model space.
    const topLeftY = transform.padY / MOVENET_INPUT_SIZE;
    const topLeftX = transform.padX / MOVENET_INPUT_SIZE;
    // Bottom-right of the drawn image.
    const bottomRightY = (transform.padY + height * scale) / MOVENET_INPUT_SIZE;
    const bottomRightX = (transform.padX + width * scale) / MOVENET_INPUT_SIZE;

    const kps = decodeMoveNetOutput(
      buildOutput([
        [topLeftY, topLeftX, 1],
        [bottomRightY, bottomRightX, 1],
      ]),
      transform,
    );

    expect(kps[0]!.x).toBeCloseTo(0, 5);
    expect(kps[0]!.y).toBeCloseTo(0, 5);
    expect(kps[1]!.x).toBeCloseTo(1, 5);
    expect(kps[1]!.y).toBeCloseTo(1, 5);
  });

  it('does not distort aspect ratio on a non-square frame', () => {
    const transform = computeLetterbox(1000, 500);
    // Two points separated by the same distance along each model axis must map
    // to different source-normalised distances, in proportion to the frame.
    const kps = decodeMoveNetOutput(
      buildOutput([
        [0.5, 0.5, 1],
        [0.6, 0.6, 1],
      ]),
      transform,
    );
    const dx = kps[1]!.x - kps[0]!.x;
    const dy = kps[1]!.y - kps[0]!.y;
    // The source is 2:1, so an equal step in the square covers twice as much
    // normalised height as width.
    expect(dy / dx).toBeCloseTo(2, 4);
  });

  it('always returns exactly 17 keypoints', () => {
    expect(decodeMoveNetOutput(new Float32Array(17 * 3), computeLetterbox(640, 480))).toHaveLength(
      17,
    );
  });

  it('preserves per-keypoint scores', () => {
    const output = buildOutput([
      [0.1, 0.1, 0.95],
      [0.2, 0.2, 0.05],
    ]);
    const kps = decodeMoveNetOutput(output, computeLetterbox(192, 192));
    expect(kps[0]!.score).toBeCloseTo(0.95, 6);
    // A low score must survive decoding so gap-filling can act on it later.
    expect(kps[1]!.score).toBeCloseTo(0.05, 6);
  });
});

describe('rgbaToUint8Nhwc', () => {
  it('drops alpha and keeps RGB order', () => {
    const rgba = new Uint8ClampedArray([10, 20, 30, 255, 40, 50, 60, 128]);
    expect(Array.from(rgbaToUint8Nhwc(rgba))).toEqual([10, 20, 30, 40, 50, 60]);
  });

  it('produces a buffer of the right length for a full input frame', () => {
    const pixels = MOVENET_INPUT_SIZE * MOVENET_INPUT_SIZE;
    const out = rgbaToUint8Nhwc(new Uint8ClampedArray(pixels * 4));
    expect(out.length).toBe(pixels * 3);
    // uint8, not normalised floats — MoveNet applies no mean/std.
    expect(out).toBeInstanceOf(Uint8Array);
  });
});

describe('keypointsToChannels', () => {
  it('splits into interleaved kp2d and flat conf', () => {
    const { kp2d, conf } = keypointsToChannels([
      { x: 0.1, y: 0.2, score: 0.8 },
      { x: 0.3, y: 0.4, score: 0.6 },
    ]);
    expect(Array.from(kp2d).map((v) => Math.round(v * 10) / 10)).toEqual([0.1, 0.2, 0.3, 0.4]);
    expect(Array.from(conf).map((v) => Math.round(v * 10) / 10)).toEqual([0.8, 0.6]);
  });

  it('matches the 17-joint layout the WMOC writer expects', () => {
    const kps = Array.from({ length: 17 }, () => ({ x: 0, y: 0, score: 0 }));
    const { kp2d, conf } = keypointsToChannels(kps);
    expect(kp2d.length).toBe(34);
    expect(conf.length).toBe(17);
  });
});

describe('containRect (overlay alignment)', () => {
  it('letterboxes a 16:9 source inside a square box', () => {
    const r = containRect(1280, 720, 400, 400)!;
    expect(r.width).toBeCloseTo(400, 5);
    expect(r.height).toBeCloseTo(225, 5);
    expect(r.x).toBeCloseTo(0, 5);
    expect(r.y).toBeCloseTo(87.5, 5);
  });

  it('pillarboxes a portrait source inside a landscape box', () => {
    const r = containRect(720, 1280, 800, 400)!;
    expect(r.height).toBeCloseTo(400, 5);
    expect(r.width).toBeCloseTo(225, 5);
    expect(r.y).toBeCloseTo(0, 5);
    expect(r.x).toBeCloseTo(287.5, 5);
  });

  it('fills exactly when aspect ratios match', () => {
    const r = containRect(1280, 720, 640, 360)!;
    expect(r).toEqual({ x: 0, y: 0, width: 640, height: 360 });
  });

  it('returns null for degenerate inputs rather than dividing by zero', () => {
    expect(containRect(0, 0, 100, 100)).toBeNull();
    expect(containRect(100, 100, 0, 0)).toBeNull();
  });
});
