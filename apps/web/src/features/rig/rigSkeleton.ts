/**
 * Three.js-flavoured view of the target humanoid.
 *
 * Deliberately a thin adapter over `@wms/skeleton` rather than a second copy of
 * the rig data. The skeleton is already defined once in TypeScript
 * (`packages/skeleton`) and once in Rust (`crates/mocap-core/src/skeleton.rs`),
 * with tests pinning them together; a third copy here would be the one that
 * silently drifts.
 *
 * All this file adds is `THREE.Vector3` convenience and the rest-pose forward
 * kinematics the viewport needs for sizing capsules and framing the camera.
 */

import * as THREE from 'three';
import {
  TARGET_JOINT_NAMES,
  TARGET_PARENTS,
  TARGET_REST_OFFSETS,
  TWIST_ESTIMATED_JOINTS,
  TWIST_LIMITATION_NOTE,
  type TargetJointName,
} from '@wms/skeleton';

export const JOINT_NAMES: readonly TargetJointName[] = TARGET_JOINT_NAMES;
export const PARENTS: readonly number[] = TARGET_PARENTS;
export const REST_OFFSETS: readonly (readonly [number, number, number])[] = TARGET_REST_OFFSETS;
export const JOINT_COUNT = TARGET_JOINT_NAMES.length;

export { TWIST_ESTIMATED_JOINTS, TWIST_LIMITATION_NOTE };
export type { TargetJointName };

/**
 * Rest-pose world positions.
 *
 * Relies on `parents[i] < i` (asserted by the skeleton package's tests) to do
 * this in a single forward pass with no recursion.
 */
export function restWorldPositions(): THREE.Vector3[] {
  const out: THREE.Vector3[] = [];
  for (let i = 0; i < JOINT_COUNT; i += 1) {
    const offset = REST_OFFSETS[i]!;
    const parent = PARENTS[i]!;
    const position = new THREE.Vector3(offset[0], offset[1], offset[2]);
    if (parent >= 0) position.add(out[parent]!);
    out.push(position);
  }
  return out;
}

/** Index of a joint by name, or -1. */
export function jointIndex(name: string): number {
  return JOINT_NAMES.indexOf(name as TargetJointName);
}

/** Whether a joint's twist is estimated rather than measured (§B.5 caveat). */
export function hasEstimatedTwist(name: string): boolean {
  return (TWIST_ESTIMATED_JOINTS as readonly string[]).includes(name);
}
