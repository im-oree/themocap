/**
 * Selection store (§B.1.2).
 *
 * Nothing in this phase sets a selection except a dev-only click-to-select on
 * the rig, used to prove the `TransformControls` plumbing works. It exists now
 * so Document 4's manual keyframe override wires behaviour into an already-built
 * and already-tested surface, instead of introducing a new dependency and a new
 * gizmo under deadline.
 *
 * Joints are identified by **name**, not index: names are stable across skeleton
 * revisions (`Chest` -> `Spine1` was already one such rename), whereas indices
 * silently shift when a joint is inserted.
 */

import { create } from 'zustand';

interface SelectionState {
  selectedJointName: string | null;
  select: (jointName: string | null) => void;
  clear: () => void;
  /** Hover is transient and separate from selection, as in any 3D editor. */
  hoveredJointName: string | null;
  setHovered: (jointName: string | null) => void;
}

export const useSelection = create<SelectionState>((set) => ({
  selectedJointName: null,
  select: (selectedJointName) => set({ selectedJointName }),
  clear: () => set({ selectedJointName: null }),
  hoveredJointName: null,
  setHovered: (hoveredJointName) => set({ hoveredJointName }),
}));
