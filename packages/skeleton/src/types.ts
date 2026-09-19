/** A named joint in a skeleton definition. */
export interface JointDef {
  /** Stable index into keypoint arrays produced by a model. */
  index: number;
  name: string;
  /** Index of the parent joint, or null for a root. */
  parent: number | null;
}

/** An edge drawn between two joints (for overlays and rig views). */
export type Bone = readonly [number, number];

export interface SkeletonDef {
  id: string;
  /** Human-readable name, e.g. "COCO 17-keypoint". */
  name: string;
  joints: JointDef[];
  bones: Bone[];
  /** 2D image-space, 3D camera/root-relative, or 3D world-space keypoints. */
  space: '2d' | '3d-relative' | '3d-world';
}

export function jointIndex(def: SkeletonDef, name: string): number {
  const joint = def.joints.find((j) => j.name === name);
  if (!joint) throw new Error(`Joint "${name}" not found in skeleton "${def.id}"`);
  return joint.index;
}

/** Validates internal consistency — indices dense, parents in range, bones valid. */
export function validateSkeleton(def: SkeletonDef): void {
  def.joints.forEach((j, i) => {
    if (j.index !== i)
      throw new Error(`${def.id}: joint ${j.name} index ${j.index} != position ${i}`);
    if (j.parent !== null && (j.parent < 0 || j.parent >= def.joints.length)) {
      throw new Error(`${def.id}: joint ${j.name} has out-of-range parent ${j.parent}`);
    }
  });
  for (const [a, b] of def.bones) {
    if (a < 0 || b < 0 || a >= def.joints.length || b >= def.joints.length) {
      throw new Error(`${def.id}: bone [${a}, ${b}] out of range`);
    }
  }
}
