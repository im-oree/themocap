/**
 * Tests for the viewport's skeleton adapter.
 *
 * `RigScene` itself needs a real WebGL context, which jsdom does not provide, so
 * the pure geometry it depends on is factored into `rigSkeleton.ts` and tested
 * here. Scene behaviour that genuinely needs GL (resize, context preservation
 * across tab switches) is covered by the Playwright suite instead.
 */

import { describe, expect, it } from 'vitest';

import {
  hasEstimatedTwist,
  jointIndex,
  JOINT_COUNT,
  JOINT_NAMES,
  PARENTS,
  REST_OFFSETS,
  restWorldPositions,
  TWIST_ESTIMATED_JOINTS,
  TWIST_LIMITATION_NOTE,
} from '../../src/features/rig/rigSkeleton';

describe('rig skeleton adapter', () => {
  it('exposes the 21-joint target humanoid', () => {
    expect(JOINT_COUNT).toBe(21);
    expect(JOINT_NAMES).toHaveLength(21);
    expect(PARENTS).toHaveLength(21);
    expect(REST_OFFSETS).toHaveLength(21);
  });

  it('starts at Hips and keeps the documented joint order', () => {
    expect(JOINT_NAMES[0]).toBe('Hips');
    expect(JOINT_NAMES[2]).toBe('Spine1');
    expect(JOINT_NAMES[20]).toBe('RightToeBase');
  });

  it('is topologically ordered so a single forward pass is valid', () => {
    expect(PARENTS[0]).toBe(-1);
    for (let i = 1; i < JOINT_COUNT; i += 1) {
      expect(PARENTS[i]!).toBeLessThan(i);
      expect(PARENTS[i]!).toBeGreaterThanOrEqual(0);
    }
  });

  it('resolves joint indices by name and reports -1 for strangers', () => {
    expect(jointIndex('Hips')).toBe(0);
    expect(jointIndex('LeftHand')).toBe(8);
    expect(jointIndex('Tail')).toBe(-1);
  });
});

describe('rest world positions', () => {
  const rest = restWorldPositions();

  it('returns one position per joint', () => {
    expect(rest).toHaveLength(JOINT_COUNT);
  });

  it('places the head at a plausible human height', () => {
    const head = rest[jointIndex('Head')]!;
    expect(head.y).toBeGreaterThan(1.4);
    expect(head.y).toBeLessThan(1.9);
  });

  it('puts the hips roughly at mid-body', () => {
    expect(rest[0]!.y).toBeCloseTo(0.95, 2);
  });

  it('is a T-pose: arms extend along X, level with the shoulders', () => {
    const leftHand = rest[jointIndex('LeftHand')]!;
    const rightHand = rest[jointIndex('RightHand')]!;
    const leftArm = rest[jointIndex('LeftArm')]!;

    // Arms run along X, not down Y.
    expect(Math.abs(leftHand.x)).toBeGreaterThan(0.5);
    expect(leftHand.y).toBeCloseTo(leftArm.y, 6);
    // +X is the character's left, per the documented convention.
    expect(leftHand.x).toBeGreaterThan(0);
    expect(rightHand.x).toBeLessThan(0);
  });

  it('is mirror-symmetric about the YZ plane', () => {
    for (const name of JOINT_NAMES) {
      if (!name.startsWith('Left')) continue;
      const mirrored = `Right${name.slice(4)}`;
      const left = rest[jointIndex(name)]!;
      const right = rest[jointIndex(mirrored)]!;
      expect(left.x).toBeCloseTo(-right.x, 6);
      expect(left.y).toBeCloseTo(right.y, 6);
      expect(left.z).toBeCloseTo(right.z, 6);
    }
  });

  it('puts the feet near the ground', () => {
    for (const name of ['LeftFoot', 'RightFoot'] as const) {
      expect(rest[jointIndex(name)]!.y).toBeLessThan(0.25);
      expect(rest[jointIndex(name)]!.y).toBeGreaterThanOrEqual(0);
    }
  });

  it('gives every non-root bone a non-zero length', () => {
    for (let i = 1; i < JOINT_COUNT; i += 1) {
      const length = rest[i]!.distanceTo(rest[PARENTS[i]!]!);
      expect(length).toBeGreaterThan(0.01);
    }
  });

  it('returns fresh vectors each call, so callers cannot corrupt the rest pose', () => {
    const a = restWorldPositions();
    a[0]!.set(99, 99, 99);
    expect(restWorldPositions()[0]!.y).toBeCloseTo(0.95, 2);
  });
});

describe('twist caveat surfacing (§B.5)', () => {
  it('flags the forearm and shin joints whose twist is estimated', () => {
    expect(TWIST_ESTIMATED_JOINTS.length).toBeGreaterThan(0);
    for (const name of TWIST_ESTIMATED_JOINTS) {
      expect(hasEstimatedTwist(name)).toBe(true);
      expect(JOINT_NAMES).toContain(name);
    }
  });

  it('does not flag joints whose rotation is fully observed', () => {
    expect(hasEstimatedTwist('Hips')).toBe(false);
    expect(hasEstimatedTwist('NotAJoint')).toBe(false);
  });

  it('ships human-readable caveat text for the inspector to display', () => {
    expect(TWIST_LIMITATION_NOTE.length).toBeGreaterThan(20);
    expect(TWIST_LIMITATION_NOTE.toLowerCase()).toContain('twist');
  });
});
