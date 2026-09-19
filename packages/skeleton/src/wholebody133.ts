import type { SkeletonDef } from './types';
import { COCO17 } from './coco17';

/**
 * COCO-WholeBody 133-keypoint topology (body 17 + feet 6 + face 68 + hands 42).
 *
 * STUB — only the body block is populated. Filled in if/when RTMW is promoted out
 * of "deferred" status (see docs/decisions.md). Hands/face are out of scope until
 * a later document brings them in.
 */
export const WHOLEBODY133_COUNT = 133;

export const WHOLEBODY133: SkeletonDef = {
  id: 'wholebody133',
  name: 'COCO-WholeBody 133-keypoint (stub)',
  space: '2d',
  joints: COCO17.joints,
  bones: COCO17.bones,
};

// TODO(RTMW evaluation): populate indices 17..132 (feet, face, hands).
