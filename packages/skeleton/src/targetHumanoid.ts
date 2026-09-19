import type { SkeletonDef } from './types';

/**
 * Target humanoid rig — the retarget destination and the skeleton BVH/glTF export
 * writes out. Finalized in Document 2 (§12).
 *
 * Naming follows the Mixamo / Unity-Humanoid convention for maximum compatibility
 * with Blender and game engines.
 *
 * ## Conventions (binding for every downstream consumer)
 *
 * - **Y-up, right-handed**, matching Three.js. Any 3D-lift model with a different
 *   native convention is corrected once at the retarget boundary
 *   (`crates/mocap-core/src/retarget`), never in the exporter.
 * - **+X is the character's LEFT**, +Z is toward the viewer (character faces -Z).
 * - **Units are metres.** The BVH exporter scales at write time (default cm).
 * - **Rest pose is a T-pose**, not an A-pose: arms straight out along ±X. Chosen
 *   because Blender's BVH import and most engine retargeting assume T-pose, and
 *   because a bone whose rest direction is axis-aligned makes the swing rotation
 *   in `retarget/` trivially verifiable in unit tests. Recorded in
 *   `docs/decisions.md`.
 * - **Topological order**: `parents[i] < i` for every joint, and the root's parent
 *   is -1. The Rust retargeter and the BVH writer both rely on this to compute
 *   world transforms in a single forward pass.
 *
 * Offsets below describe an approximately 1.75 m adult. They are a *rest* skeleton:
 * per-subject bone lengths are estimated later (Document 3's calibration work).
 */

export const TARGET_JOINT_NAMES = [
  'Hips',
  'Spine',
  'Spine1',
  'Neck',
  'Head',
  'LeftShoulder',
  'LeftArm',
  'LeftForeArm',
  'LeftHand',
  'RightShoulder',
  'RightArm',
  'RightForeArm',
  'RightHand',
  'LeftUpLeg',
  'LeftLeg',
  'LeftFoot',
  'LeftToeBase',
  'RightUpLeg',
  'RightLeg',
  'RightFoot',
  'RightToeBase',
] as const;

export type TargetJointName = (typeof TARGET_JOINT_NAMES)[number];

/** `parents[i]` is the index of joint `i`'s parent; -1 for the root. */
export const TARGET_PARENTS: readonly number[] = [
  -1, // 0  Hips
  0, // 1  Spine
  1, // 2  Spine1
  2, // 3  Neck
  3, // 4  Head
  2, // 5  LeftShoulder
  5, // 6  LeftArm
  6, // 7  LeftForeArm
  7, // 8  LeftHand
  2, // 9  RightShoulder
  9, // 10 RightArm
  10, // 11 RightForeArm
  11, // 12 RightHand
  0, // 13 LeftUpLeg
  13, // 14 LeftLeg
  14, // 15 LeftFoot
  15, // 16 LeftToeBase
  0, // 17 RightUpLeg
  17, // 18 RightLeg
  18, // 19 RightFoot
  19, // 20 RightToeBase
];

/**
 * Offset of each joint from its parent, in metres, in the T-pose rest pose.
 * The root's offset is its height above the ground plane.
 */
export const TARGET_REST_OFFSETS: readonly (readonly [number, number, number])[] = [
  [0, 0.95, 0], // 0  Hips (above ground)
  [0, 0.1, 0], // 1  Spine
  [0, 0.17, 0], // 2  Spine1
  [0, 0.22, 0], // 3  Neck
  [0, 0.1, 0], // 4  Head
  [0.05, 0.18, 0], // 5  LeftShoulder
  [0.13, 0, 0], // 6  LeftArm
  [0.26, 0, 0], // 7  LeftForeArm
  [0.24, 0, 0], // 8  LeftHand
  [-0.05, 0.18, 0], // 9  RightShoulder
  [-0.13, 0, 0], // 10 RightArm
  [-0.26, 0, 0], // 11 RightForeArm
  [-0.24, 0, 0], // 12 RightHand
  [0.09, -0.06, 0], // 13 LeftUpLeg
  [0, -0.4, 0], // 14 LeftLeg
  [0, -0.4, 0], // 15 LeftFoot
  [0, -0.07, 0.14], // 16 LeftToeBase
  [-0.09, -0.06, 0], // 17 RightUpLeg
  [0, -0.4, 0], // 18 RightLeg
  [0, -0.4, 0], // 19 RightFoot
  [0, -0.07, 0.14], // 20 RightToeBase
];

/** Limb grouping, used to colour the rig view and the 2D overlay identically. */
export type LimbGroup = 'spine' | 'head' | 'armLeft' | 'armRight' | 'legLeft' | 'legRight';

export const TARGET_LIMB_GROUPS: readonly LimbGroup[] = [
  'spine', // Hips
  'spine', // Spine
  'spine', // Spine1
  'head', // Neck
  'head', // Head
  'armLeft', // LeftShoulder
  'armLeft', // LeftArm
  'armLeft', // LeftForeArm
  'armLeft', // LeftHand
  'armRight', // RightShoulder
  'armRight', // RightArm
  'armRight', // RightForeArm
  'armRight', // RightHand
  'legLeft', // LeftUpLeg
  'legLeft', // LeftLeg
  'legLeft', // LeftFoot
  'legLeft', // LeftToeBase
  'legRight', // RightUpLeg
  'legRight', // RightLeg
  'legRight', // RightFoot
  'legRight', // RightToeBase
];

/**
 * Joints whose twist about the bone axis is *estimated by propagation*, not
 * measured — the source pose models provide no roll signal for these.
 *
 * Surfaced to the user per acceptance criterion §17.9; see `TWIST_LIMITATION_NOTE`.
 */
export const TWIST_ESTIMATED_JOINTS: readonly TargetJointName[] = [
  'LeftForeArm',
  'RightForeArm',
  'LeftLeg',
  'RightLeg',
];

export const TWIST_LIMITATION_NOTE =
  'Forearm and lower-leg twist is estimated, not measured. The 2D/3D pose models ' +
  'provide no roll signal for these bones, so their twist is propagated from the ' +
  'parent bone.';

export const TARGET_HUMANOID: SkeletonDef = {
  id: 'target-humanoid',
  name: 'Target humanoid rig (T-pose)',
  space: '3d-world',
  joints: TARGET_JOINT_NAMES.map((name, index) => ({
    index,
    name,
    parent: TARGET_PARENTS[index] === -1 ? null : (TARGET_PARENTS[index] as number),
  })),
  bones: TARGET_PARENTS.flatMap((parent, index) =>
    parent === -1 ? [] : [[parent, index] as const],
  ),
};

export const TARGET_JOINT_COUNT = TARGET_JOINT_NAMES.length;

export function targetJointIndex(name: TargetJointName): number {
  return TARGET_JOINT_NAMES.indexOf(name);
}

/** Rest-pose world positions, derived by walking the hierarchy once. */
export function targetRestWorldPositions(): Float32Array {
  const out = new Float32Array(TARGET_JOINT_COUNT * 3);
  for (let i = 0; i < TARGET_JOINT_COUNT; i++) {
    const offset = TARGET_REST_OFFSETS[i]!;
    const parent = TARGET_PARENTS[i]!;
    const px = parent === -1 ? 0 : out[parent * 3]!;
    const py = parent === -1 ? 0 : out[parent * 3 + 1]!;
    const pz = parent === -1 ? 0 : out[parent * 3 + 2]!;
    out[i * 3] = px + offset[0];
    out[i * 3 + 1] = py + offset[1];
    out[i * 3 + 2] = pz + offset[2];
  }
  return out;
}
