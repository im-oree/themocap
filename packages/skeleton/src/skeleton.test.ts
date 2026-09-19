import { describe, expect, it } from 'vitest';
import { COCO17, COCO17_NAMES } from './coco17';
import { H36M17 } from './h36m17';
import { TARGET_HUMANOID } from './targetHumanoid';
import { jointIndex, validateSkeleton } from './types';

describe('skeleton definitions', () => {
  it('COCO17 has 17 joints in canonical order', () => {
    expect(COCO17.joints).toHaveLength(17);
    expect(COCO17.joints.map((j) => j.name)).toEqual([...COCO17_NAMES]);
    expect(jointIndex(COCO17, 'left_wrist')).toBe(9);
    expect(jointIndex(COCO17, 'right_ankle')).toBe(16);
  });

  it.each([
    ['coco17', COCO17],
    ['h36m17', H36M17],
    ['target-humanoid', TARGET_HUMANOID],
  ])('%s is internally consistent', (_id, def) => {
    expect(() => validateSkeleton(def)).not.toThrow();
  });

  it('H36M17 is rooted at the pelvis with a single root', () => {
    expect(H36M17.joints.filter((j) => j.parent === null).map((j) => j.name)).toEqual(['pelvis']);
  });

  it('throws for unknown joints', () => {
    expect(() => jointIndex(COCO17, 'tail')).toThrow(/not found/);
  });
});
