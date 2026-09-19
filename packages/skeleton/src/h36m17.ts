import type { SkeletonDef } from './types';

/**
 * Human3.6M 17-joint topology — the input/output convention of the 3D lift
 * candidates (MotionBERT). STUB: joint order below is the standard H36M order and
 * is correct, but the COCO->H36M remap used at runtime lands in Document 2.
 */
export const H36M17_NAMES = [
  'pelvis',
  'right_hip',
  'right_knee',
  'right_ankle',
  'left_hip',
  'left_knee',
  'left_ankle',
  'spine',
  'thorax',
  'neck',
  'head',
  'left_shoulder',
  'left_elbow',
  'left_wrist',
  'right_shoulder',
  'right_elbow',
  'right_wrist',
] as const;

const PARENT_INDICES = [null, 0, 1, 2, 0, 4, 5, 0, 7, 8, 9, 8, 11, 12, 8, 14, 15] as const;

export const H36M17: SkeletonDef = {
  id: 'h36m17',
  name: 'Human3.6M 17-joint',
  space: '3d-relative',
  joints: H36M17_NAMES.map((name, index) => ({
    index,
    name,
    parent: PARENT_INDICES[index] ?? null,
  })),
  bones: PARENT_INDICES.flatMap((parent, index) =>
    parent === null ? [] : [[parent, index] as const],
  ),
};

// TODO(Document 2): COCO17 -> H36M17 conversion (hip/thorax synthesis from shoulders).
