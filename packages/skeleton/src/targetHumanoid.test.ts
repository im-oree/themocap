import { describe, expect, it } from 'vitest';
import {
  TARGET_HUMANOID,
  TARGET_JOINT_COUNT,
  TARGET_JOINT_NAMES,
  TARGET_LIMB_GROUPS,
  TARGET_PARENTS,
  TARGET_REST_OFFSETS,
  TWIST_ESTIMATED_JOINTS,
  targetJointIndex,
  targetRestWorldPositions,
} from './targetHumanoid';
import { validateSkeleton } from './types';

describe('target humanoid skeleton', () => {
  it('has the 21 Mixamo/Unity-Humanoid joints', () => {
    expect(TARGET_JOINT_NAMES).toHaveLength(21);
    expect(TARGET_PARENTS).toHaveLength(21);
    expect(TARGET_REST_OFFSETS).toHaveLength(21);
    expect(TARGET_LIMB_GROUPS).toHaveLength(21);
    expect(TARGET_JOINT_COUNT).toBe(21);
  });

  it('is rooted at Hips with exactly one root', () => {
    expect(TARGET_PARENTS.filter((p) => p === -1)).toHaveLength(1);
    expect(TARGET_PARENTS[0]).toBe(-1);
    expect(TARGET_JOINT_NAMES[0]).toBe('Hips');
  });

  it('is topologically ordered so a single forward pass is valid', () => {
    // The Rust retargeter and BVH writer both depend on parents[i] < i.
    TARGET_PARENTS.forEach((parent, i) => {
      if (parent === -1) return;
      expect(parent).toBeLessThan(i);
      expect(parent).toBeGreaterThanOrEqual(0);
    });
  });

  it('has no cycles and every joint reaches the root', () => {
    for (let i = 0; i < TARGET_JOINT_COUNT; i++) {
      const seen = new Set<number>();
      let cursor = i;
      while (cursor !== -1) {
        expect(seen.has(cursor)).toBe(false);
        seen.add(cursor);
        cursor = TARGET_PARENTS[cursor]!;
      }
      expect(seen.has(0)).toBe(true);
    }
  });

  it('passes the shared skeleton validator', () => {
    expect(() => validateSkeleton(TARGET_HUMANOID)).not.toThrow();
  });

  it('is left/right symmetric about the YZ plane', () => {
    const pairs: [string, string][] = [
      ['LeftShoulder', 'RightShoulder'],
      ['LeftArm', 'RightArm'],
      ['LeftForeArm', 'RightForeArm'],
      ['LeftHand', 'RightHand'],
      ['LeftUpLeg', 'RightUpLeg'],
      ['LeftLeg', 'RightLeg'],
      ['LeftFoot', 'RightFoot'],
      ['LeftToeBase', 'RightToeBase'],
    ];
    for (const [l, r] of pairs) {
      const lo = TARGET_REST_OFFSETS[targetJointIndex(l as never)]!;
      const ro = TARGET_REST_OFFSETS[targetJointIndex(r as never)]!;
      expect(lo[0]).toBeCloseTo(-ro[0], 9); // mirrored in X
      expect(lo[1]).toBeCloseTo(ro[1], 9);
      expect(lo[2]).toBeCloseTo(ro[2], 9);
    }
  });

  it('rests in a T-pose: arms extend along ±X with no vertical drop', () => {
    for (const name of ['LeftArm', 'LeftForeArm', 'LeftHand'] as const) {
      const offset = TARGET_REST_OFFSETS[targetJointIndex(name)]!;
      expect(offset[0]).toBeGreaterThan(0); // +X is the character's left
      expect(offset[1]).toBeCloseTo(0, 9); // horizontal => T-pose, not A-pose
      expect(offset[2]).toBeCloseTo(0, 9);
    }
    for (const name of ['RightArm', 'RightForeArm', 'RightHand'] as const) {
      expect(TARGET_REST_OFFSETS[targetJointIndex(name)]![0]).toBeLessThan(0);
    }
  });

  it('produces a plausible adult rest skeleton standing on the ground', () => {
    const world = targetRestWorldPositions();
    const y = (name: string) => world[targetJointIndex(name as never) * 3 + 1]!;

    // Feet at/near the ground, head around 1.7 m.
    expect(y('LeftFoot')).toBeCloseTo(y('RightFoot'), 9);
    expect(Math.abs(y('LeftFoot'))).toBeLessThan(0.15);
    expect(y('Head')).toBeGreaterThan(1.5);
    expect(y('Head')).toBeLessThan(1.9);
    // Ordering sanity: head above hips above knees above feet.
    expect(y('Head')).toBeGreaterThan(y('Hips'));
    expect(y('Hips')).toBeGreaterThan(y('LeftLeg'));
    expect(y('LeftLeg')).toBeGreaterThan(y('LeftFoot'));
  });

  it('spans a realistic arm width in the rest pose', () => {
    const world = targetRestWorldPositions();
    const lh = world[targetJointIndex('LeftHand') * 3]!;
    const rh = world[targetJointIndex('RightHand') * 3]!;
    expect(lh - rh).toBeGreaterThan(1.2); // fingertip-to-fingertip ≈ height
    expect(lh - rh).toBeLessThan(2.0);
  });

  it('flags exactly the bones with no measurable roll signal', () => {
    expect([...TWIST_ESTIMATED_JOINTS].sort()).toEqual([
      'LeftForeArm',
      'LeftLeg',
      'RightForeArm',
      'RightLeg',
    ]);
  });
});
