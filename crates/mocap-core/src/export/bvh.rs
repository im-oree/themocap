//! BVH writer (master spec §11, Document 2 §14).
//!
//! # Channel order
//!
//! Root: `Xposition Yposition Zposition Zrotation Xrotation Yrotation`.
//! Others: `Zrotation Xrotation Yrotation`.
//!
//! ZXY is the de-facto BVH standard (it is what Biovision emitted and what
//! Blender's importer assumes). The *order the channels are listed* is also the
//! order they are applied, so a joint's local rotation matrix is `Rz * Rx * Ry`.
//! `quat_to_zxy_euler` inverts exactly that composition; `euler_zxy_to_quat` in the
//! tests re-composes it, and the round-trip test proves the pair agree.
//!
//! # Units
//!
//! Internally everything is metres. The exporter multiplies every *position*
//! channel and every rest offset by `scale`, so centimetre output (Blender's
//! default expectation) is `BvhUnits::Centimeters`. Rotations are unaffected.
//!
//! # Coordinate system
//!
//! Y-up, right-handed — already guaranteed by the retarget stage, which
//! canonicalizes whatever the 3D-lift model emits. The exporter performs no axis
//! conversion of its own; if output looks rotated in Blender the bug is upstream.

use wasm_bindgen::prelude::*;

use crate::retarget::swing_twist::Quat;
use crate::retarget::RetargetedFrame;
use crate::skeleton::{JOINT_COUNT, JOINT_NAMES, PARENTS, REST_OFFSETS};

#[wasm_bindgen]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum BvhUnits {
    Meters = 0,
    Centimeters = 1,
}

impl BvhUnits {
    pub fn scale(self) -> f64 {
        match self {
            BvhUnits::Meters => 1.0,
            BvhUnits::Centimeters => 100.0,
        }
    }
}

/// Euler angles in degrees, ordered as the BVH channels are written (Z, X, Y).
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct EulerZxy {
    pub z: f64,
    pub x: f64,
    pub y: f64,
}

/// Decomposes a quaternion into ZXY Euler angles (degrees) matching `Rz * Rx * Ry`.
pub fn quat_to_zxy_euler(q: Quat) -> EulerZxy {
    let [qx, qy, qz, qw] = q;

    // Rotation-matrix entries of R = Rz * Rx * Ry:
    //   m21 = sin(x)
    //   m01 = -sin(z)cos(x)   m11 = cos(z)cos(x)
    //   m20 = -cos(x)sin(y)   m22 = cos(x)cos(y)
    let m00 = 1.0 - 2.0 * (qy * qy + qz * qz);
    let m01 = 2.0 * (qx * qy - qw * qz);
    let m10 = 2.0 * (qx * qy + qw * qz);
    let m11 = 1.0 - 2.0 * (qx * qx + qz * qz);
    let m20 = 2.0 * (qx * qz - qw * qy);
    let m21 = 2.0 * (qy * qz + qw * qx);
    let m22 = 1.0 - 2.0 * (qx * qx + qy * qy);

    let sin_x = m21.clamp(-1.0, 1.0);
    let x = sin_x.asin();

    // Gimbal lock: at x = +/-90 deg, cos(x) = 0 and Z and Y act on the same axis,
    // so m01/m11/m20/m22 all vanish. Pin Y to zero and fold the whole rotation
    // into Z, which m00/m10 still resolve unambiguously.
    let (z, y) = if sin_x.abs() > 0.999_999 {
        (m10.atan2(m00), 0.0)
    } else {
        ((-m01).atan2(m11), (-m20).atan2(m22))
    };

    EulerZxy {
        z: z.to_degrees().neg_zero_safe(),
        x: x.to_degrees().neg_zero_safe(),
        y: y.to_degrees().neg_zero_safe(),
    }
}

trait NegZeroSafe {
    fn neg_zero_safe(self) -> f64;
}

impl NegZeroSafe for f64 {
    fn neg_zero_safe(self) -> f64 {
        if self == 0.0 {
            0.0
        } else {
            self
        }
    }
}

fn fmt_num(v: f64) -> String {
    // Six decimals is plenty for mm precision in centimetres, and keeps files small.
    let s = format!("{:.6}", v);
    if s == "-0.000000" {
        "0.000000".to_string()
    } else {
        s
    }
}

fn indent(depth: usize) -> String {
    "  ".repeat(depth)
}

/// Children of each joint, in index order.
fn children_of(joint: usize) -> Vec<usize> {
    (0..JOINT_COUNT)
        .filter(|j| PARENTS[*j] == joint as i32)
        .collect()
}

fn write_joint(out: &mut String, joint: usize, depth: usize, scale: f64) {
    let is_root = PARENTS[joint] < 0;
    let offset = REST_OFFSETS[joint];
    let pad = indent(depth);

    if is_root {
        out.push_str(&format!("ROOT {}\n", JOINT_NAMES[joint]));
    } else {
        out.push_str(&format!("{pad}JOINT {}\n", JOINT_NAMES[joint]));
    }
    out.push_str(&format!("{pad}{{\n"));

    let inner = indent(depth + 1);
    // `RetargetedFrame::root_pos` is already an absolute world position (the hip
    // centre), and `forward_kinematics` likewise ignores `REST_OFFSETS[0]` for the
    // root. So the ROOT's HIERARCHY offset must be zero and the position channels
    // must carry `root_pos` verbatim -- adding the rest offset to either would
    // float the whole rig off the ground.
    let (ox, oy, oz) = if is_root {
        (0.0, 0.0, 0.0)
    } else {
        (offset[0] * scale, offset[1] * scale, offset[2] * scale)
    };
    out.push_str(&format!(
        "{inner}OFFSET {} {} {}\n",
        fmt_num(ox),
        fmt_num(oy),
        fmt_num(oz)
    ));

    if is_root {
        out.push_str(&format!(
            "{inner}CHANNELS 6 Xposition Yposition Zposition Zrotation Xrotation Yrotation\n"
        ));
    } else {
        out.push_str(&format!(
            "{inner}CHANNELS 3 Zrotation Xrotation Yrotation\n"
        ));
    }

    let children = children_of(joint);
    if children.is_empty() {
        // BVH requires a terminating End Site giving the bone its length.
        out.push_str(&format!("{inner}End Site\n{inner}{{\n"));
        // Extend along the bone's own rest direction; fall back to a short +Y nub.
        let len = (offset[0].powi(2) + offset[1].powi(2) + offset[2].powi(2)).sqrt();
        let (ex, ey, ez) = if len < 1e-9 {
            (0.0, 0.05 * scale, 0.0)
        } else {
            (
                offset[0] / len * 0.1 * scale,
                offset[1] / len * 0.1 * scale,
                offset[2] / len * 0.1 * scale,
            )
        };
        out.push_str(&format!(
            "{}OFFSET {} {} {}\n",
            indent(depth + 2),
            fmt_num(ex),
            fmt_num(ey),
            fmt_num(ez)
        ));
        out.push_str(&format!("{inner}}}\n"));
    } else {
        for child in children {
            write_joint(out, child, depth + 1, scale);
        }
    }

    out.push_str(&format!("{pad}}}\n"));
}

/// Depth-first joint order, exactly as `write_joint` emits the HIERARCHY block.
/// This is the order MOTION channel values must appear in.
pub fn hierarchy_order() -> Vec<usize> {
    fn walk(joint: usize, out: &mut Vec<usize>) {
        out.push(joint);
        for child in children_of(joint) {
            walk(child, out);
        }
    }
    let mut out = Vec::with_capacity(JOINT_COUNT);
    walk(0, &mut out);
    out
}

/// Writes a complete BVH document for a retargeted clip.
pub fn write_bvh(frames: &[RetargetedFrame], fps: f64, units: BvhUnits) -> String {
    let scale = units.scale();
    let mut out = String::new();

    out.push_str("HIERARCHY\n");
    write_joint(&mut out, 0, 0, scale);

    out.push_str("MOTION\n");
    out.push_str(&format!("Frames: {}\n", frames.len()));
    out.push_str(&format!(
        "Frame Time: {}\n",
        fmt_num(if fps > 0.0 { 1.0 / fps } else { 1.0 / 30.0 })
    ));

    let order = hierarchy_order();
    for frame in frames {
        let mut values: Vec<String> = Vec::with_capacity(3 + JOINT_COUNT * 3);
        values.push(fmt_num(frame.root_pos[0] * scale));
        values.push(fmt_num(frame.root_pos[1] * scale));
        values.push(fmt_num(frame.root_pos[2] * scale));

        // Channel values must follow the depth-first order the HIERARCHY block was
        // written in. `hierarchy_order` makes that explicit rather than relying on
        // the (currently true) coincidence that index order is already depth-first.
        for &joint in &order {
            let q = frame
                .joint_rot
                .get(joint)
                .copied()
                .unwrap_or([0.0, 0.0, 0.0, 1.0]);
            let e = quat_to_zxy_euler(q);
            values.push(fmt_num(e.z));
            values.push(fmt_num(e.x));
            values.push(fmt_num(e.y));
        }
        out.push_str(&values.join(" "));
        out.push('\n');
    }

    out
}

#[wasm_bindgen]
pub struct BvhClip {
    frames: Vec<RetargetedFrame>,
}

#[wasm_bindgen]
impl BvhClip {
    #[wasm_bindgen(constructor)]
    pub fn new() -> BvhClip {
        BvhClip { frames: Vec::new() }
    }

    /// Appends one frame from a packed `[root xyz, quat xyzw * JOINT_COUNT]` buffer,
    /// the same layout `retarget_pose` produces and the rig ring buffer carries.
    pub fn push_packed(&mut self, packed: &[f32]) -> Result<(), JsError> {
        let expected = 3 + JOINT_COUNT * 4;
        if packed.len() != expected {
            return Err(JsError::new(&format!(
                "push_packed: expected {expected} floats, got {}",
                packed.len()
            )));
        }
        let mut joint_rot = Vec::with_capacity(JOINT_COUNT);
        for j in 0..JOINT_COUNT {
            let b = 3 + j * 4;
            joint_rot.push([
                packed[b] as f64,
                packed[b + 1] as f64,
                packed[b + 2] as f64,
                packed[b + 3] as f64,
            ]);
        }
        self.frames.push(RetargetedFrame {
            root_pos: [packed[0] as f64, packed[1] as f64, packed[2] as f64],
            joint_rot,
        });
        Ok(())
    }

    #[wasm_bindgen(getter)]
    pub fn frame_count(&self) -> usize {
        self.frames.len()
    }

    /// Serializes to a BVH document. `centimeters` matches Blender's default expectation.
    pub fn to_bvh(&self, fps: f64, units: BvhUnits) -> String {
        write_bvh(&self.frames, fps, units)
    }
}

impl Default for BvhClip {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::retarget::swing_twist::{quat_from_axis_angle, quat_mul, quat_rotate};
    use crate::retarget::{forward_kinematics, retarget_frame, test_support::t_pose_keypoints};
    use crate::skeleton;
    use approx::assert_relative_eq;
    use std::f64::consts::PI;

    /// Test-only inverse of `quat_to_zxy_euler`: recompose Rz * Rx * Ry.
    fn euler_zxy_to_quat(e: EulerZxy) -> Quat {
        let rz = quat_from_axis_angle([0.0, 0.0, 1.0], e.z.to_radians());
        let rx = quat_from_axis_angle([1.0, 0.0, 0.0], e.x.to_radians());
        let ry = quat_from_axis_angle([0.0, 1.0, 0.0], e.y.to_radians());
        quat_mul(quat_mul(rz, rx), ry)
    }

    fn assert_same_rotation(a: Quat, b: Quat, eps: f64) {
        // Compare by action on basis vectors: q and -q are the same rotation.
        for v in [[1.0, 0.0, 0.0], [0.0, 1.0, 0.0], [0.0, 0.0, 1.0]] {
            let ra = quat_rotate(a, v);
            let rb = quat_rotate(b, v);
            for i in 0..3 {
                assert_relative_eq!(ra[i], rb[i], epsilon = eps);
            }
        }
    }

    #[test]
    fn euler_conversion_round_trips() {
        let cases = [
            quat_from_axis_angle([1.0, 0.0, 0.0], 0.3),
            quat_from_axis_angle([0.0, 1.0, 0.0], -0.8),
            quat_from_axis_angle([0.0, 0.0, 1.0], 1.9),
            quat_from_axis_angle([0.4, 0.5, 0.75], 1.1),
            quat_mul(
                quat_from_axis_angle([0.0, 0.0, 1.0], 0.5),
                quat_from_axis_angle([1.0, 0.0, 0.0], 0.4),
            ),
        ];
        for q in cases {
            let back = euler_zxy_to_quat(quat_to_zxy_euler(q));
            assert_same_rotation(q, back, 1e-6);
        }
    }

    #[test]
    fn identity_maps_to_zero_angles() {
        let e = quat_to_zxy_euler([0.0, 0.0, 0.0, 1.0]);
        assert_relative_eq!(e.x, 0.0, epsilon = 1e-9);
        assert_relative_eq!(e.y, 0.0, epsilon = 1e-9);
        assert_relative_eq!(e.z, 0.0, epsilon = 1e-9);
    }

    #[test]
    fn header_has_the_documented_channel_orders() {
        let bvh = write_bvh(&[RetargetedFrame::rest()], 30.0, BvhUnits::Centimeters);
        assert!(bvh.starts_with("HIERARCHY\nROOT Hips\n"));
        assert!(bvh.contains(
            "CHANNELS 6 Xposition Yposition Zposition Zrotation Xrotation Yrotation"
        ));
        assert!(bvh.contains("CHANNELS 3 Zrotation Xrotation Yrotation"));
        assert!(bvh.contains("MOTION\nFrames: 1\n"));
        assert!(bvh.contains("Frame Time: 0.033333"));
    }

    #[test]
    fn every_joint_appears_exactly_once_with_end_sites_on_leaves() {
        let bvh = write_bvh(&[], 30.0, BvhUnits::Meters);
        for name in JOINT_NAMES {
            let needle_joint = format!("JOINT {name}\n");
            let needle_root = format!("ROOT {name}\n");
            let count = bvh.matches(&needle_joint).count() + bvh.matches(&needle_root).count();
            assert_eq!(count, 1, "{name} appeared {count} times");
        }
        // Leaves: Head, both hands, both toes.
        assert_eq!(bvh.matches("End Site").count(), 5);
    }

    #[test]
    fn braces_are_balanced() {
        let bvh = write_bvh(&[RetargetedFrame::rest()], 30.0, BvhUnits::Meters);
        assert_eq!(bvh.matches('{').count(), bvh.matches('}').count());
    }

    #[test]
    fn units_scale_positions_but_not_rotations() {
        let mut frame = RetargetedFrame::rest();
        frame.root_pos = [0.0, 1.0, 0.0];
        frame.joint_rot[skeleton::SPINE] = quat_from_axis_angle([1.0, 0.0, 0.0], 0.5);

        let m = write_bvh(std::slice::from_ref(&frame), 30.0, BvhUnits::Meters);
        let cm = write_bvh(std::slice::from_ref(&frame), 30.0, BvhUnits::Centimeters);

        let m_motion: Vec<f64> = last_motion_line(&m);
        let cm_motion: Vec<f64> = last_motion_line(&cm);

        // Positions scale by 100...
        for i in 0..3 {
            assert_relative_eq!(cm_motion[i], m_motion[i] * 100.0, epsilon = 1e-4);
        }
        // ...rotations do not.
        for i in 3..m_motion.len() {
            assert_relative_eq!(cm_motion[i], m_motion[i], epsilon = 1e-9);
        }
        // And the rest offsets scale too.
        assert!(cm.contains("OFFSET 0.000000 10.000000 0.000000")); // Spine, 0.1m
    }

    fn last_motion_line(bvh: &str) -> Vec<f64> {
        bvh.lines()
            .last()
            .unwrap()
            .split_whitespace()
            .map(|v| v.parse().unwrap())
            .collect()
    }

    #[test]
    fn motion_line_has_one_value_per_channel() {
        let frames = vec![RetargetedFrame::rest(); 3];
        let bvh = write_bvh(&frames, 30.0, BvhUnits::Meters);
        let lines: Vec<&str> = bvh.lines().collect();
        let motion_start = lines.iter().position(|l| l.starts_with("Frame Time")).unwrap() + 1;
        let motion_lines = &lines[motion_start..];
        assert_eq!(motion_lines.len(), 3);
        for line in motion_lines {
            assert_eq!(line.split_whitespace().count(), 3 + JOINT_COUNT * 3);
        }
    }

    // ---- Round-trip test (§14.5): parse our own output and rebuild the pose ----

    struct ParsedBvh {
        names: Vec<String>,
        parents: Vec<i32>,
        offsets: Vec<[f64; 3]>,
        channels: Vec<usize>,
        frames: Vec<Vec<f64>>,
        frame_time: f64,
    }

    /// Minimal test-only BVH parser — deliberately independent of the writer's
    /// internals so it can catch structural mistakes, not just echo them back.
    fn parse_bvh(text: &str) -> ParsedBvh {
        let mut names = Vec::new();
        let mut parents = Vec::new();
        let mut offsets = Vec::new();
        let mut channels = Vec::new();
        let mut stack: Vec<i32> = Vec::new();
        let mut current: i32 = -1;
        let mut in_end_site = false;
        let mut frames = Vec::new();
        let mut frame_time = 0.0;
        let mut in_motion = false;

        for raw in text.lines() {
            let line = raw.trim();
            if line.is_empty() {
                continue;
            }
            let mut parts = line.split_whitespace();
            let head = parts.next().unwrap();

            if in_motion {
                if let Some(rest) = line.strip_prefix("Frames:") {
                    let _ = rest.trim().parse::<usize>().unwrap();
                } else if let Some(rest) = line.strip_prefix("Frame Time:") {
                    frame_time = rest.trim().parse().unwrap();
                } else {
                    frames.push(
                        line.split_whitespace()
                            .map(|v| v.parse::<f64>().unwrap())
                            .collect(),
                    );
                }
                continue;
            }

            match head {
                "HIERARCHY" => {}
                "MOTION" => in_motion = true,
                "ROOT" | "JOINT" => {
                    names.push(parts.next().unwrap().to_string());
                    parents.push(current);
                    offsets.push([0.0; 3]);
                    channels.push(0);
                    current = (names.len() - 1) as i32;
                }
                "End" => in_end_site = true,
                "{" => stack.push(current),
                "}" => {
                    if in_end_site {
                        in_end_site = false;
                    } else {
                        stack.pop();
                        current = *stack.last().unwrap_or(&-1);
                    }
                }
                "OFFSET" => {
                    if !in_end_site {
                        let v: Vec<f64> = parts.map(|p| p.parse().unwrap()).collect();
                        let idx = current as usize;
                        offsets[idx] = [v[0], v[1], v[2]];
                    }
                }
                "CHANNELS" => {
                    let n: usize = parts.next().unwrap().parse().unwrap();
                    channels[current as usize] = n;
                }
                _ => {}
            }
        }

        ParsedBvh {
            names,
            parents,
            offsets,
            channels,
            frames,
            frame_time,
        }
    }

    /// Rebuilds world joint positions from parsed hierarchy + one frame's channels.
    fn world_from_parsed(p: &ParsedBvh, frame: &[f64], scale: f64) -> Vec<[f64; 3]> {
        let n = p.names.len();
        let mut cursor = 0usize;
        let mut local_rot = vec![[0.0, 0.0, 0.0, 1.0]; n];
        let mut root_translation = [0.0; 3];

        for j in 0..n {
            if p.channels[j] == 6 {
                root_translation = [
                    frame[cursor] / scale,
                    frame[cursor + 1] / scale,
                    frame[cursor + 2] / scale,
                ];
                cursor += 3;
            }
            let e = EulerZxy {
                z: frame[cursor],
                x: frame[cursor + 1],
                y: frame[cursor + 2],
            };
            cursor += 3;
            local_rot[j] = euler_zxy_to_quat(e);
        }

        let mut world_rot = vec![[0.0, 0.0, 0.0, 1.0]; n];
        let mut world_pos = vec![[0.0f64; 3]; n];
        for j in 0..n {
            let parent = p.parents[j];
            if parent < 0 {
                world_rot[j] = local_rot[j];
                world_pos[j] = root_translation;
            } else {
                let pr = world_rot[parent as usize];
                let pp = world_pos[parent as usize];
                world_rot[j] = quat_mul(pr, local_rot[j]);
                let off = [
                    p.offsets[j][0] / scale,
                    p.offsets[j][1] / scale,
                    p.offsets[j][2] / scale,
                ];
                let r = quat_rotate(pr, off);
                world_pos[j] = [pp[0] + r[0], pp[1] + r[1], pp[2] + r[2]];
            }
        }
        world_pos
    }

    #[test]
    fn round_trips_within_one_millimetre() {
        // Build a non-trivial pose: bent elbow + raised knee.
        let mut kp = t_pose_keypoints();
        let w = skeleton::rest_world_positions();
        crate::retarget::test_support::set_kp(
            &mut kp,
            crate::retarget::coco::LEFT_WRIST,
            [
                w[skeleton::LEFT_FOREARM][0],
                w[skeleton::LEFT_FOREARM][1] - 0.24,
                w[skeleton::LEFT_FOREARM][2],
            ],
        );
        crate::retarget::test_support::set_kp(
            &mut kp,
            crate::retarget::coco::RIGHT_ANKLE,
            [
                w[skeleton::RIGHT_LEG][0],
                w[skeleton::RIGHT_LEG][1] - 0.2,
                w[skeleton::RIGHT_LEG][2] + 0.35,
            ],
        );

        let frame = retarget_frame(&kp, None);
        let expected = forward_kinematics(&frame);

        for units in [BvhUnits::Meters, BvhUnits::Centimeters] {
            let text = write_bvh(std::slice::from_ref(&frame), 30.0, units);
            let parsed = parse_bvh(&text);

            assert_eq!(parsed.names.len(), JOINT_COUNT);
            assert_eq!(parsed.names[0], "Hips");
            assert_relative_eq!(parsed.frame_time, 1.0 / 30.0, epsilon = 1e-5);

            let got = world_from_parsed(&parsed, &parsed.frames[0], units.scale());
            for j in 0..JOINT_COUNT {
                for axis in 0..3 {
                    assert!(
                        (got[j][axis] - expected[j][axis]).abs() < 1e-3,
                        "{} axis {axis}: {} vs {} ({:?})",
                        JOINT_NAMES[j],
                        got[j][axis],
                        expected[j][axis],
                        units
                    );
                }
            }
        }
    }

    #[test]
    fn parsed_hierarchy_matches_the_source_skeleton() {
        let text = write_bvh(&[RetargetedFrame::rest()], 30.0, BvhUnits::Meters);
        let parsed = parse_bvh(&text);
        for j in 0..JOINT_COUNT {
            let idx = parsed.names.iter().position(|n| n == JOINT_NAMES[j]).unwrap();
            let parent_name = if PARENTS[j] < 0 {
                None
            } else {
                Some(JOINT_NAMES[PARENTS[j] as usize])
            };
            let parsed_parent = if parsed.parents[idx] < 0 {
                None
            } else {
                Some(parsed.names[parsed.parents[idx] as usize].as_str())
            };
            assert_eq!(parsed_parent, parent_name, "parent mismatch for {}", JOINT_NAMES[j]);
        }
    }

    #[test]
    fn a_rest_frame_stands_upright_at_the_expected_height() {
        let mut frame = RetargetedFrame::rest();
        // The root carries an absolute world position; stand the rig on the ground.
        frame.root_pos = REST_OFFSETS[0];
        let text = write_bvh(std::slice::from_ref(&frame), 30.0, BvhUnits::Centimeters);
        let parsed = parse_bvh(&text);
        let world = world_from_parsed(&parsed, &parsed.frames[0], 100.0);
        let head = world[JOINT_NAMES.iter().position(|n| *n == "Head").unwrap()];
        // Hips at 0.95m => head near 1.54m, not 0 and not doubled to ~2.5m.
        assert!(head[1] > 1.4 && head[1] < 1.7, "head at {head:?}");
    }

    #[test]
    fn half_turn_survives_the_euler_round_trip() {
        // 180 degree rotations are where naive Euler conversions break down.
        let q = quat_from_axis_angle([0.0, 1.0, 0.0], PI);
        assert_same_rotation(euler_zxy_to_quat(quat_to_zxy_euler(q)), q, 1e-6);
    }

    #[test]
    fn empty_clip_still_produces_a_valid_document() {
        let bvh = write_bvh(&[], 30.0, BvhUnits::Meters);
        assert!(bvh.contains("Frames: 0"));
        assert!(bvh.contains("HIERARCHY"));
        assert_eq!(bvh.matches('{').count(), bvh.matches('}').count());
    }
}
