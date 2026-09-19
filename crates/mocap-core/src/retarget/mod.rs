//! Retargeting: source 3D keypoints -> target humanoid joint rotations.
//!
//! # Algorithm
//!
//! For each target bone, take the direction between the two source keypoints that
//! correspond to it, and find the shortest-arc rotation carrying the bone's *rest*
//! direction onto that observed direction. Because rotations are stored relative to
//! the parent, the parent's accumulated world rotation is divided out before the
//! local rotation is stored, which is what makes twist propagate down the chain.
//!
//! # Twist
//!
//! A bone direction constrains two of three rotational degrees of freedom: roll
//! about the bone's own axis is unobservable from two endpoints. For forearms and
//! lower legs the source models give us no roll signal at all, so their twist is
//! inherited from the parent bone (elbow/knee) rather than invented. This is a real
//! limitation, surfaced in the UI via `TWIST_LIMITATION_NOTE` per acceptance
//! criterion §17.9, not a bug.
//!
//! # Coordinate convention
//!
//! Y-up, right-handed, +X = the character's left, metres — matching Three.js and
//! `targetHumanoid`. Models with a different native convention are corrected *here*
//! (see `SourceConvention`), never downstream: the rig view, the BVH exporter and
//! any future glTF exporter all rely on retarget output already being canonical.

pub mod swing_twist;

use wasm_bindgen::prelude::*;

use crate::skeleton::{self, JOINT_COUNT, PARENTS};
use swing_twist::{
    normalize, quat_conjugate, quat_mul, quat_rotate, shortest_arc, Quat, Vec3, IDENTITY,
};

/// COCO-17 keypoint indices, the output convention of the live 2D/3D models.
pub mod coco {
    pub const NOSE: usize = 0;
    pub const LEFT_SHOULDER: usize = 5;
    pub const RIGHT_SHOULDER: usize = 6;
    pub const LEFT_ELBOW: usize = 7;
    pub const RIGHT_ELBOW: usize = 8;
    pub const LEFT_WRIST: usize = 9;
    pub const RIGHT_WRIST: usize = 10;
    pub const LEFT_HIP: usize = 11;
    pub const RIGHT_HIP: usize = 12;
    pub const LEFT_KNEE: usize = 13;
    pub const RIGHT_KNEE: usize = 14;
    pub const LEFT_ANKLE: usize = 15;
    pub const RIGHT_ANKLE: usize = 16;
    pub const COUNT: usize = 17;
}

/// Native axis convention of the 3D-lift model, normalized to Y-up here.
#[wasm_bindgen]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum SourceConvention {
    /// Already Y-up, right-handed (BlazePose world landmarks).
    YUp = 0,
    /// Y grows downward, as in image space (many camera-space lifters).
    YDown = 1,
    /// Z-up, right-handed (Human3.6M-style motion capture data).
    ZUp = 2,
}

/// One frame of retargeted motion.
#[derive(Clone, Debug, PartialEq)]
pub struct RetargetedFrame {
    pub root_pos: [f64; 3],
    /// Local (parent-relative) rotation per joint, `[x, y, z, w]`.
    pub joint_rot: Vec<Quat>,
}

impl RetargetedFrame {
    pub fn rest() -> Self {
        RetargetedFrame {
            root_pos: [0.0, 0.0, 0.0],
            joint_rot: vec![IDENTITY; JOINT_COUNT],
        }
    }
}

fn get(kp: &[f32], i: usize) -> Vec3 {
    [kp[i * 3] as f64, kp[i * 3 + 1] as f64, kp[i * 3 + 2] as f64]
}

fn midpoint(a: Vec3, b: Vec3) -> Vec3 {
    [
        (a[0] + b[0]) * 0.5,
        (a[1] + b[1]) * 0.5,
        (a[2] + b[2]) * 0.5,
    ]
}

fn sub(a: Vec3, b: Vec3) -> Vec3 {
    [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
}

/// Rewrites source keypoints into the canonical Y-up frame, once, at the boundary.
pub fn canonicalize(kp3d: &[f32], convention: SourceConvention) -> Vec<f32> {
    let mut out = kp3d.to_vec();
    match convention {
        SourceConvention::YUp => {}
        SourceConvention::YDown => {
            // Flip Y, and Z with it, to preserve handedness.
            for i in (0..out.len()).step_by(3) {
                out[i + 1] = -out[i + 1];
                out[i + 2] = -out[i + 2];
            }
        }
        SourceConvention::ZUp => {
            // (x, y, z)_zup -> (x, z, -y)_yup
            for i in (0..out.len()).step_by(3) {
                let y = out[i + 1];
                let z = out[i + 2];
                out[i + 1] = z;
                out[i + 2] = -y;
            }
        }
    }
    out
}

/// Source keypoint pair defining each target bone's direction.
///
/// `None` marks a joint with no direct observation: its rotation stays identity in
/// its parent's frame, i.e. it inherits the parent's orientation including twist.
fn bone_endpoints(joint: usize) -> Option<(BoneSource, BoneSource)> {
    use BoneSource::*;
    Some(match joint {
        skeleton::SPINE | skeleton::SPINE1 => (HipCenter, ShoulderCenter),
        skeleton::NECK => (ShoulderCenter, Kp(coco::NOSE)),
        skeleton::LEFT_ARM => (Kp(coco::LEFT_SHOULDER), Kp(coco::LEFT_ELBOW)),
        skeleton::LEFT_FOREARM => (Kp(coco::LEFT_ELBOW), Kp(coco::LEFT_WRIST)),
        skeleton::RIGHT_ARM => (Kp(coco::RIGHT_SHOULDER), Kp(coco::RIGHT_ELBOW)),
        skeleton::RIGHT_FOREARM => (Kp(coco::RIGHT_ELBOW), Kp(coco::RIGHT_WRIST)),
        skeleton::LEFT_UPLEG => (Kp(coco::LEFT_HIP), Kp(coco::LEFT_KNEE)),
        skeleton::LEFT_LEG => (Kp(coco::LEFT_KNEE), Kp(coco::LEFT_ANKLE)),
        skeleton::RIGHT_UPLEG => (Kp(coco::RIGHT_HIP), Kp(coco::RIGHT_KNEE)),
        skeleton::RIGHT_LEG => (Kp(coco::RIGHT_KNEE), Kp(coco::RIGHT_ANKLE)),
        skeleton::LEFT_SHOULDER => (ShoulderCenter, Kp(coco::LEFT_SHOULDER)),
        skeleton::RIGHT_SHOULDER => (ShoulderCenter, Kp(coco::RIGHT_SHOULDER)),
        // Head, hands, feet and toes have no reliable second point in COCO-17.
        _ => return None,
    })
}

#[derive(Clone, Copy)]
enum BoneSource {
    Kp(usize),
    HipCenter,
    ShoulderCenter,
}

fn resolve(source: BoneSource, kp: &[f32]) -> Vec3 {
    match source {
        BoneSource::Kp(i) => get(kp, i),
        BoneSource::HipCenter => midpoint(get(kp, coco::LEFT_HIP), get(kp, coco::RIGHT_HIP)),
        BoneSource::ShoulderCenter => midpoint(
            get(kp, coco::LEFT_SHOULDER),
            get(kp, coco::RIGHT_SHOULDER),
        ),
    }
}

/// Minimum confidence for a keypoint to steer a bone. Below this the bone holds
/// its parent's orientation rather than snapping to a noisy direction.
pub const MIN_BONE_CONFIDENCE: f32 = 0.2;

fn confident(conf: Option<&[f32]>, source: BoneSource) -> bool {
    let Some(conf) = conf else { return true };
    let ok = |i: usize| conf.get(i).copied().unwrap_or(1.0) >= MIN_BONE_CONFIDENCE;
    match source {
        BoneSource::Kp(i) => ok(i),
        BoneSource::HipCenter => ok(coco::LEFT_HIP) && ok(coco::RIGHT_HIP),
        BoneSource::ShoulderCenter => ok(coco::LEFT_SHOULDER) && ok(coco::RIGHT_SHOULDER),
    }
}

/// Retargets one frame of canonical Y-up COCO-17 keypoints onto the target rig.
///
/// `conf` is optional; when supplied, bones whose source keypoints fall below
/// [`MIN_BONE_CONFIDENCE`] keep their parent's orientation.
pub fn retarget_frame(kp3d_yup: &[f32], conf: Option<&[f32]>) -> RetargetedFrame {
    assert!(
        kp3d_yup.len() >= coco::COUNT * 3,
        "retarget_frame: expected at least {} floats, got {}",
        coco::COUNT * 3,
        kp3d_yup.len()
    );

    let mut local = vec![IDENTITY; JOINT_COUNT];
    let mut world = vec![IDENTITY; JOINT_COUNT];

    for joint in 0..JOINT_COUNT {
        let parent = PARENTS[joint];
        let parent_world = if parent < 0 {
            IDENTITY
        } else {
            world[parent as usize]
        };

        let observed = bone_endpoints(joint)
            .filter(|(from, to)| confident(conf, *from) && confident(conf, *to))
            .and_then(|(from, to)| normalize(sub(resolve(to, kp3d_yup), resolve(from, kp3d_yup))));

        match (observed, skeleton::rest_bone_direction(joint)) {
            (Some(dir), Some(rest_dir)) => {
                // Rest direction carried into the parent's current frame...
                let rest_in_world = quat_rotate(parent_world, rest_dir);
                // ...then the shortest arc from there to what we actually see.
                let delta = shortest_arc(rest_in_world, dir);
                let world_rot = quat_mul(delta, parent_world);
                // Store parent-relative so twist flows down the chain naturally.
                local[joint] = quat_mul(quat_conjugate(parent_world), world_rot);
                world[joint] = world_rot;
            }
            _ => {
                // No usable observation: inherit the parent's orientation (and twist).
                local[joint] = IDENTITY;
                world[joint] = parent_world;
            }
        }
    }

    let hip_center = midpoint(get(kp3d_yup, coco::LEFT_HIP), get(kp3d_yup, coco::RIGHT_HIP));

    RetargetedFrame {
        root_pos: hip_center,
        joint_rot: local,
    }
}

/// Forward kinematics: local rotations + rest offsets -> world joint positions.
pub fn forward_kinematics(frame: &RetargetedFrame) -> Vec<[f64; 3]> {
    let mut world_rot = vec![IDENTITY; JOINT_COUNT];
    let mut world_pos = vec![[0.0f64; 3]; JOINT_COUNT];

    for joint in 0..JOINT_COUNT {
        let parent = PARENTS[joint];
        let (parent_rot, parent_pos) = if parent < 0 {
            (IDENTITY, frame.root_pos)
        } else {
            (world_rot[parent as usize], world_pos[parent as usize])
        };

        world_rot[joint] = quat_mul(parent_rot, frame.joint_rot[joint]);

        if parent < 0 {
            // The root's offset is absorbed by root_pos.
            world_pos[joint] = parent_pos;
        } else {
            let offset = quat_rotate(parent_rot, skeleton::REST_OFFSETS[joint]);
            world_pos[joint] = [
                parent_pos[0] + offset[0],
                parent_pos[1] + offset[1],
                parent_pos[2] + offset[2],
            ];
        }
    }
    world_pos
}

/// WASM entry point: canonicalize + retarget, returning a flat
/// `[rootX, rootY, rootZ, q0x, q0y, q0z, q0w, ...]` buffer for the rig ring buffer.
#[wasm_bindgen]
pub fn retarget_pose(kp3d: &[f32], conf: Option<Vec<f32>>, convention: SourceConvention) -> Vec<f32> {
    let canonical = canonicalize(kp3d, convention);
    let frame = retarget_frame(&canonical, conf.as_deref());
    let mut out = Vec::with_capacity(3 + JOINT_COUNT * 4);
    out.extend(frame.root_pos.iter().map(|v| *v as f32));
    for q in &frame.joint_rot {
        out.extend(q.iter().map(|v| *v as f32));
    }
    out
}

#[cfg(test)]
pub(crate) mod test_support {
    use super::*;

    /// Builds COCO-17 keypoints from the target rig's own rest pose, so a perfect
    /// T-pose input is expressible and must retarget to identity rotations.
    pub fn t_pose_keypoints() -> Vec<f32> {
        let w = skeleton::rest_world_positions();
        let mut kp = vec![0.0f32; coco::COUNT * 3];
        let mut set = |i: usize, p: [f64; 3]| {
            kp[i * 3] = p[0] as f32;
            kp[i * 3 + 1] = p[1] as f32;
            kp[i * 3 + 2] = p[2] as f32;
        };
        // Nose sits just above the head joint, along the neck direction.
        set(
            coco::NOSE,
            [w[skeleton::HEAD][0], w[skeleton::HEAD][1] + 0.1, w[skeleton::HEAD][2]],
        );
        set(coco::LEFT_SHOULDER, w[skeleton::LEFT_ARM]);
        set(coco::RIGHT_SHOULDER, w[skeleton::RIGHT_ARM]);
        set(coco::LEFT_ELBOW, w[skeleton::LEFT_FOREARM]);
        set(coco::RIGHT_ELBOW, w[skeleton::RIGHT_FOREARM]);
        set(coco::LEFT_WRIST, w[skeleton::LEFT_HAND]);
        set(coco::RIGHT_WRIST, w[skeleton::RIGHT_HAND]);
        set(coco::LEFT_HIP, w[skeleton::LEFT_UPLEG]);
        set(coco::RIGHT_HIP, w[skeleton::RIGHT_UPLEG]);
        set(coco::LEFT_KNEE, w[skeleton::LEFT_LEG]);
        set(coco::RIGHT_KNEE, w[skeleton::RIGHT_LEG]);
        set(coco::LEFT_ANKLE, w[skeleton::LEFT_FOOT]);
        set(coco::RIGHT_ANKLE, w[skeleton::RIGHT_FOOT]);
        kp
    }

    pub fn set_kp(kp: &mut [f32], i: usize, p: [f64; 3]) {
        kp[i * 3] = p[0] as f32;
        kp[i * 3 + 1] = p[1] as f32;
        kp[i * 3 + 2] = p[2] as f32;
    }
}

#[cfg(test)]
mod tests {
    use super::test_support::{set_kp, t_pose_keypoints};
    use super::*;
    use approx::assert_relative_eq;
    use std::f64::consts::FRAC_PI_2;

    fn assert_identity(q: Quat, label: &str) {
        assert_relative_eq!(q[3].abs(), 1.0, epsilon = 1e-6);
        for i in 0..3 {
            assert_relative_eq!(q[i], 0.0, epsilon = 1e-6, max_relative = 1e-6);
        }
        let _ = label;
    }

    #[test]
    fn t_pose_retargets_to_identity_rotations() {
        // The headline correctness property: rest pose in => rest pose out.
        let kp = t_pose_keypoints();
        let frame = retarget_frame(&kp, None);
        for joint in [
            skeleton::LEFT_ARM,
            skeleton::LEFT_FOREARM,
            skeleton::RIGHT_ARM,
            skeleton::RIGHT_FOREARM,
            skeleton::LEFT_UPLEG,
            skeleton::LEFT_LEG,
            skeleton::RIGHT_UPLEG,
            skeleton::RIGHT_LEG,
            skeleton::SPINE,
        ] {
            assert_identity(frame.joint_rot[joint], skeleton::JOINT_NAMES[joint]);
        }
    }

    #[test]
    fn t_pose_root_sits_at_the_hip_centre() {
        let frame = retarget_frame(&t_pose_keypoints(), None);
        let rest = skeleton::rest_world_positions();
        let expected_y = (rest[skeleton::LEFT_UPLEG][1] + rest[skeleton::RIGHT_UPLEG][1]) * 0.5;
        assert_relative_eq!(frame.root_pos[1], expected_y, epsilon = 1e-6);
        assert_relative_eq!(frame.root_pos[0], 0.0, epsilon = 1e-6);
    }

    #[test]
    fn bent_elbow_produces_the_expected_swing() {
        // Forearm points straight down instead of out along +X: a 90 deg bend.
        let mut kp = t_pose_keypoints();
        let elbow = {
            let w = skeleton::rest_world_positions();
            w[skeleton::LEFT_FOREARM]
        };
        set_kp(&mut kp, coco::LEFT_WRIST, [elbow[0], elbow[1] - 0.24, elbow[2]]);

        let frame = retarget_frame(&kp, None);
        let world = forward_kinematics(&frame);

        // The hand must actually end up below the elbow.
        assert!(
            world[skeleton::LEFT_HAND][1] < world[skeleton::LEFT_FOREARM][1] - 0.2,
            "hand not below elbow: {:?}",
            world[skeleton::LEFT_HAND]
        );
        // And the rotation magnitude must be ~90 degrees.
        let q = frame.joint_rot[skeleton::LEFT_FOREARM];
        let angle = 2.0 * q[3].abs().clamp(-1.0, 1.0).acos();
        assert_relative_eq!(angle, FRAC_PI_2, epsilon = 1e-3);
    }

    #[test]
    fn forward_kinematics_reproduces_the_input_directions() {
        // Round trip: retarget then FK must land the joints back where observed.
        let mut kp = t_pose_keypoints();
        let w = skeleton::rest_world_positions();
        set_kp(
            &mut kp,
            coco::LEFT_WRIST,
            [
                w[skeleton::LEFT_FOREARM][0],
                w[skeleton::LEFT_FOREARM][1] - 0.24,
                w[skeleton::LEFT_FOREARM][2],
            ],
        );
        let frame = retarget_frame(&kp, None);
        let world = forward_kinematics(&frame);

        let observed_dir = normalize(sub(
            [
                kp[coco::LEFT_WRIST * 3] as f64,
                kp[coco::LEFT_WRIST * 3 + 1] as f64,
                kp[coco::LEFT_WRIST * 3 + 2] as f64,
            ],
            [
                kp[coco::LEFT_ELBOW * 3] as f64,
                kp[coco::LEFT_ELBOW * 3 + 1] as f64,
                kp[coco::LEFT_ELBOW * 3 + 2] as f64,
            ],
        ))
        .unwrap();
        let fk_dir = normalize(sub(world[skeleton::LEFT_HAND], world[skeleton::LEFT_FOREARM])).unwrap();
        for i in 0..3 {
            assert_relative_eq!(fk_dir[i], observed_dir[i], epsilon = 1e-6);
        }
    }

    #[test]
    fn twist_propagates_from_parent_when_unobservable() {
        // The forearm has no roll signal, so it must inherit the upper arm's frame:
        // its local rotation stays identity while its world orientation follows.
        let kp = t_pose_keypoints();
        let frame = retarget_frame(&kp, None);
        assert_identity(frame.joint_rot[skeleton::LEFT_HAND], "LeftHand");
        // Hand has no endpoints at all => pure inheritance.
        assert!(bone_endpoints(skeleton::LEFT_HAND).is_none());
        assert!(bone_endpoints(skeleton::HEAD).is_none());
    }

    #[test]
    fn low_confidence_keypoints_do_not_steer_a_bone() {
        let mut kp = t_pose_keypoints();
        // Garbage wrist position, but flagged as unreliable.
        set_kp(&mut kp, coco::LEFT_WRIST, [99.0, -99.0, 99.0]);
        let mut conf = vec![1.0f32; coco::COUNT];
        conf[coco::LEFT_WRIST] = 0.01;

        let frame = retarget_frame(&kp, Some(&conf));
        assert_identity(frame.joint_rot[skeleton::LEFT_FOREARM], "LeftForeArm");
    }

    #[test]
    fn canonicalize_y_down_flips_to_y_up() {
        let kp = vec![1.0f32, 2.0, 3.0];
        let out = canonicalize(&kp, SourceConvention::YDown);
        assert_eq!(out, vec![1.0, -2.0, -3.0]);
    }

    #[test]
    fn canonicalize_z_up_rotates_into_y_up() {
        let kp = vec![1.0f32, 2.0, 3.0];
        let out = canonicalize(&kp, SourceConvention::ZUp);
        assert_eq!(out, vec![1.0, 3.0, -2.0]);
    }

    #[test]
    fn canonicalize_y_up_is_a_no_op() {
        let kp = vec![1.0f32, 2.0, 3.0];
        assert_eq!(canonicalize(&kp, SourceConvention::YUp), kp);
    }

    #[test]
    fn wasm_entry_point_packs_root_then_quaternions() {
        let kp = t_pose_keypoints();
        let packed = retarget_pose(&kp, None, SourceConvention::YUp);
        assert_eq!(packed.len(), 3 + JOINT_COUNT * 4);
        // Every quaternion must be unit length.
        for j in 0..JOINT_COUNT {
            let base = 3 + j * 4;
            let n = (0..4)
                .map(|k| (packed[base + k] as f64).powi(2))
                .sum::<f64>()
                .sqrt();
            assert_relative_eq!(n, 1.0, epsilon = 1e-5);
        }
    }

    #[test]
    fn a_raised_arm_moves_the_hand_upward() {
        let mut kp = t_pose_keypoints();
        let w = skeleton::rest_world_positions();
        let shoulder = w[skeleton::LEFT_ARM];
        // Elbow and wrist straight up from the shoulder.
        set_kp(
            &mut kp,
            coco::LEFT_ELBOW,
            [shoulder[0], shoulder[1] + 0.26, shoulder[2]],
        );
        set_kp(
            &mut kp,
            coco::LEFT_WRIST,
            [shoulder[0], shoulder[1] + 0.50, shoulder[2]],
        );
        let world = forward_kinematics(&retarget_frame(&kp, None));
        assert!(
            world[skeleton::LEFT_HAND][1] > world[skeleton::LEFT_ARM][1] + 0.4,
            "hand did not rise: {:?}",
            world[skeleton::LEFT_HAND]
        );
    }
}
