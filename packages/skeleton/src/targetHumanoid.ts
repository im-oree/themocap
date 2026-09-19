import type { SkeletonDef } from './types';

/**
 * Placeholder retarget target — a conventional humanoid rig close to the
 * Mixamo/VRM-style hierarchy that BVH/glTF export will use.
 *
 * PLACEHOLDER: refined in Document 2 when retargeting and IK land. Bone lengths,
 * rest pose, and axis conventions are deliberately not specified yet.
 */
const HIERARCHY: [name: string, parent: string | null][] = [
  ['Hips', null],
  ['Spine', 'Hips'],
  ['Chest', 'Spine'],
  ['Neck', 'Chest'],
  ['Head', 'Neck'],
  ['LeftShoulder', 'Chest'],
  ['LeftArm', 'LeftShoulder'],
  ['LeftForeArm', 'LeftArm'],
  ['LeftHand', 'LeftForeArm'],
  ['RightShoulder', 'Chest'],
  ['RightArm', 'RightShoulder'],
  ['RightForeArm', 'RightArm'],
  ['RightHand', 'RightForeArm'],
  ['LeftUpLeg', 'Hips'],
  ['LeftLeg', 'LeftUpLeg'],
  ['LeftFoot', 'LeftLeg'],
  ['LeftToeBase', 'LeftFoot'],
  ['RightUpLeg', 'Hips'],
  ['RightLeg', 'RightUpLeg'],
  ['RightFoot', 'RightLeg'],
  ['RightToeBase', 'RightFoot'],
];

const names = HIERARCHY.map(([n]) => n);

export const TARGET_HUMANOID: SkeletonDef = {
  id: 'target-humanoid',
  name: 'Target humanoid rig (placeholder)',
  space: '3d-world',
  joints: HIERARCHY.map(([name, parent], index) => ({
    index,
    name,
    parent: parent === null ? null : names.indexOf(parent),
  })),
  bones: HIERARCHY.flatMap(([, parent], index) =>
    parent === null ? [] : [[names.indexOf(parent), index] as const],
  ),
};
