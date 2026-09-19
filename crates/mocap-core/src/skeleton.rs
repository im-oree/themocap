//! Rust-side mirror of `packages/skeleton`'s target humanoid rig.
//!
//! Kept in lockstep with `packages/skeleton/src/targetHumanoid.ts`; the layout
//! test in that file and `rest_pose_matches_typescript` here guard against drift.
//! Conventions (Y-up, right-handed, +X = character's left, metres, T-pose rest,
//! `parents[i] < i`) are documented on the TypeScript side.

pub const JOINT_COUNT: usize = 21;

pub const JOINT_NAMES: [&str; JOINT_COUNT] = [
    "Hips",
    "Spine",
    "Spine1",
    "Neck",
    "Head",
    "LeftShoulder",
    "LeftArm",
    "LeftForeArm",
    "LeftHand",
    "RightShoulder",
    "RightArm",
    "RightForeArm",
    "RightHand",
    "LeftUpLeg",
    "LeftLeg",
    "LeftFoot",
    "LeftToeBase",
    "RightUpLeg",
    "RightLeg",
    "RightFoot",
    "RightToeBase",
];

/// -1 marks the root.
pub const PARENTS: [i32; JOINT_COUNT] = [
    -1, 0, 1, 2, 3, 2, 5, 6, 7, 2, 9, 10, 11, 0, 13, 14, 15, 0, 17, 18, 19,
];

/// Offset from parent, metres, in the T-pose rest pose.
pub const REST_OFFSETS: [[f64; 3]; JOINT_COUNT] = [
    [0.0, 0.95, 0.0],
    [0.0, 0.10, 0.0],
    [0.0, 0.17, 0.0],
    [0.0, 0.22, 0.0],
    [0.0, 0.10, 0.0],
    [0.05, 0.18, 0.0],
    [0.13, 0.0, 0.0],
    [0.26, 0.0, 0.0],
    [0.24, 0.0, 0.0],
    [-0.05, 0.18, 0.0],
    [-0.13, 0.0, 0.0],
    [-0.26, 0.0, 0.0],
    [-0.24, 0.0, 0.0],
    [0.09, -0.06, 0.0],
    [0.0, -0.40, 0.0],
    [0.0, -0.40, 0.0],
    [0.0, -0.07, 0.14],
    [-0.09, -0.06, 0.0],
    [0.0, -0.40, 0.0],
    [0.0, -0.40, 0.0],
    [0.0, -0.07, 0.14],
];

// Named indices used by the retargeter.
pub const HIPS: usize = 0;
pub const SPINE: usize = 1;
pub const SPINE1: usize = 2;
pub const NECK: usize = 3;
pub const HEAD: usize = 4;
pub const LEFT_SHOULDER: usize = 5;
pub const LEFT_ARM: usize = 6;
pub const LEFT_FOREARM: usize = 7;
pub const LEFT_HAND: usize = 8;
pub const RIGHT_SHOULDER: usize = 9;
pub const RIGHT_ARM: usize = 10;
pub const RIGHT_FOREARM: usize = 11;
pub const RIGHT_HAND: usize = 12;
pub const LEFT_UPLEG: usize = 13;
pub const LEFT_LEG: usize = 14;
pub const LEFT_FOOT: usize = 15;
pub const LEFT_TOE: usize = 16;
pub const RIGHT_UPLEG: usize = 17;
pub const RIGHT_LEG: usize = 18;
pub const RIGHT_FOOT: usize = 19;
pub const RIGHT_TOE: usize = 20;

pub fn joint_index(name: &str) -> Option<usize> {
    JOINT_NAMES.iter().position(|n| *n == name)
}

/// Rest-pose world positions, one forward pass (valid because `parents[i] < i`).
pub fn rest_world_positions() -> [[f64; 3]; JOINT_COUNT] {
    let mut out = [[0.0f64; 3]; JOINT_COUNT];
    for i in 0..JOINT_COUNT {
        let parent = PARENTS[i];
        let base = if parent < 0 {
            [0.0, 0.0, 0.0]
        } else {
            out[parent as usize]
        };
        for axis in 0..3 {
            out[i][axis] = base[axis] + REST_OFFSETS[i][axis];
        }
    }
    out
}

/// Rest-pose direction of the bone *ending* at `joint` (parent -> joint), normalized.
pub fn rest_bone_direction(joint: usize) -> Option<[f64; 3]> {
    let offset = REST_OFFSETS[joint];
    let len = (offset[0] * offset[0] + offset[1] * offset[1] + offset[2] * offset[2]).sqrt();
    if len < 1e-12 {
        None
    } else {
        Some([offset[0] / len, offset[1] / len, offset[2] / len])
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn hierarchy_is_topologically_ordered() {
        assert_eq!(PARENTS[0], -1);
        for (i, parent) in PARENTS.iter().enumerate() {
            if *parent >= 0 {
                assert!((*parent as usize) < i, "joint {i} has a forward parent");
            }
        }
        assert_eq!(PARENTS.iter().filter(|p| **p == -1).count(), 1);
    }

    #[test]
    fn rest_pose_matches_typescript() {
        // Spot-check values that packages/skeleton asserts on its side.
        let world = rest_world_positions();
        assert!((world[HEAD][1] - 1.54).abs() < 0.01, "{:?}", world[HEAD]);
        assert!(world[LEFT_HAND][0] > 0.0);
        assert!(world[RIGHT_HAND][0] < 0.0);
        assert!((world[LEFT_HAND][0] + world[RIGHT_HAND][0]).abs() < 1e-9);
    }

    #[test]
    fn arms_rest_along_the_x_axis_t_pose() {
        let dir = rest_bone_direction(LEFT_FOREARM).unwrap();
        assert!((dir[0] - 1.0).abs() < 1e-9);
        assert!(dir[1].abs() < 1e-9);
        let dir_r = rest_bone_direction(RIGHT_FOREARM).unwrap();
        assert!((dir_r[0] + 1.0).abs() < 1e-9);
    }

    #[test]
    fn legs_rest_pointing_down() {
        assert!((rest_bone_direction(LEFT_LEG).unwrap()[1] + 1.0).abs() < 1e-9);
        assert!((rest_bone_direction(RIGHT_LEG).unwrap()[1] + 1.0).abs() < 1e-9);
    }

    #[test]
    fn root_has_no_bone_direction_ambiguity() {
        assert_eq!(joint_index("Hips"), Some(0));
        assert_eq!(joint_index("NotAJoint"), None);
    }
}
