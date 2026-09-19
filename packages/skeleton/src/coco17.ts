import type { SkeletonDef } from './types';

/**
 * COCO 17-keypoint topology — the output format of the 2D pose candidates
 * (RTMPose, ViTPose) benchmarked in Document 1. Fully correct as of this phase.
 *
 * Canonical order:
 * 0 nose, 1 left_eye, 2 right_eye, 3 left_ear, 4 right_ear, 5 left_shoulder,
 * 6 right_shoulder, 7 left_elbow, 8 right_elbow, 9 left_wrist, 10 right_wrist,
 * 11 left_hip, 12 right_hip, 13 left_knee, 14 right_knee, 15 left_ankle, 16 right_ankle
 */
export const COCO17_NAMES = [
  'nose',
  'left_eye',
  'right_eye',
  'left_ear',
  'right_ear',
  'left_shoulder',
  'right_shoulder',
  'left_elbow',
  'right_elbow',
  'left_wrist',
  'right_wrist',
  'left_hip',
  'right_hip',
  'left_knee',
  'right_knee',
  'left_ankle',
  'right_ankle',
] as const;

export type Coco17Name = (typeof COCO17_NAMES)[number];

/** COCO has no true hierarchy; parents encode a practical drawing tree. */
const PARENTS: Record<Coco17Name, Coco17Name | null> = {
  nose: null,
  left_eye: 'nose',
  right_eye: 'nose',
  left_ear: 'left_eye',
  right_ear: 'right_eye',
  left_shoulder: 'nose',
  right_shoulder: 'nose',
  left_elbow: 'left_shoulder',
  right_elbow: 'right_shoulder',
  left_wrist: 'left_elbow',
  right_wrist: 'right_elbow',
  left_hip: 'left_shoulder',
  right_hip: 'right_shoulder',
  left_knee: 'left_hip',
  right_knee: 'right_hip',
  left_ankle: 'left_knee',
  right_ankle: 'right_knee',
};

export const COCO17: SkeletonDef = {
  id: 'coco17',
  name: 'COCO 17-keypoint',
  space: '2d',
  joints: COCO17_NAMES.map((name, index) => {
    const parentName = PARENTS[name];
    return {
      index,
      name,
      parent: parentName === null ? null : COCO17_NAMES.indexOf(parentName),
    };
  }),
  bones: [
    [15, 13],
    [13, 11],
    [16, 14],
    [14, 12],
    [11, 12],
    [5, 11],
    [6, 12],
    [5, 6],
    [5, 7],
    [6, 8],
    [7, 9],
    [8, 10],
    [1, 2],
    [0, 1],
    [0, 2],
    [1, 3],
    [2, 4],
    [3, 5],
    [4, 6],
  ],
};
