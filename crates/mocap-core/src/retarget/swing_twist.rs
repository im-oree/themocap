//! Quaternion helpers for swing/twist decomposition.
//!
//! Conventions: quaternions are `[x, y, z, w]`, right-handed, Y-up — matching
//! Three.js and `packages/skeleton`'s `targetHumanoid`.

pub type Quat = [f64; 4];
pub type Vec3 = [f64; 3];

pub const IDENTITY: Quat = [0.0, 0.0, 0.0, 1.0];

pub fn dot(a: Vec3, b: Vec3) -> f64 {
    a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
}

pub fn cross(a: Vec3, b: Vec3) -> Vec3 {
    [
        a[1] * b[2] - a[2] * b[1],
        a[2] * b[0] - a[0] * b[2],
        a[0] * b[1] - a[1] * b[0],
    ]
}

pub fn length(v: Vec3) -> f64 {
    dot(v, v).sqrt()
}

pub fn normalize(v: Vec3) -> Option<Vec3> {
    let len = length(v);
    if len < 1e-12 {
        None
    } else {
        Some([v[0] / len, v[1] / len, v[2] / len])
    }
}

pub fn quat_normalize(q: Quat) -> Quat {
    let len = (q[0] * q[0] + q[1] * q[1] + q[2] * q[2] + q[3] * q[3]).sqrt();
    if len < 1e-12 {
        IDENTITY
    } else {
        [q[0] / len, q[1] / len, q[2] / len, q[3] / len]
    }
}

/// Hamilton product: the rotation `a` applied after `b`.
pub fn quat_mul(a: Quat, b: Quat) -> Quat {
    let [ax, ay, az, aw] = a;
    let [bx, by, bz, bw] = b;
    [
        aw * bx + ax * bw + ay * bz - az * by,
        aw * by - ax * bz + ay * bw + az * bx,
        aw * bz + ax * by - ay * bx + az * bw,
        aw * bw - ax * bx - ay * by - az * bz,
    ]
}

pub fn quat_conjugate(q: Quat) -> Quat {
    [-q[0], -q[1], -q[2], q[3]]
}

pub fn quat_rotate(q: Quat, v: Vec3) -> Vec3 {
    // v' = v + 2 * cross(q.xyz, cross(q.xyz, v) + q.w * v)
    let u = [q[0], q[1], q[2]];
    let t = cross(u, v);
    let t2 = [t[0] + q[3] * v[0], t[1] + q[3] * v[1], t[2] + q[3] * v[2]];
    let r = cross(u, t2);
    [v[0] + 2.0 * r[0], v[1] + 2.0 * r[1], v[2] + 2.0 * r[2]]
}

pub fn quat_from_axis_angle(axis: Vec3, angle: f64) -> Quat {
    match normalize(axis) {
        None => IDENTITY,
        Some(a) => {
            let half = angle * 0.5;
            let s = half.sin();
            [a[0] * s, a[1] * s, a[2] * s, half.cos()]
        }
    }
}

/// Shortest-arc rotation taking unit vector `from` onto unit vector `to`.
///
/// The antiparallel case has no unique answer, so we pick any perpendicular axis
/// deterministically — without this guard a 180° bone flip yields NaN.
pub fn shortest_arc(from: Vec3, to: Vec3) -> Quat {
    let (f, t) = match (normalize(from), normalize(to)) {
        (Some(f), Some(t)) => (f, t),
        _ => return IDENTITY,
    };

    let d = dot(f, t).clamp(-1.0, 1.0);
    if d > 1.0 - 1e-9 {
        return IDENTITY;
    }
    if d < -1.0 + 1e-9 {
        // Antiparallel: rotate 180° about any axis perpendicular to `f`.
        let seed: Vec3 = if f[0].abs() < 0.9 {
            [1.0, 0.0, 0.0]
        } else {
            [0.0, 1.0, 0.0]
        };
        let axis = normalize(cross(f, seed)).unwrap_or([0.0, 0.0, 1.0]);
        return [axis[0], axis[1], axis[2], 0.0];
    }

    let axis = cross(f, t);
    let w = 1.0 + d;
    quat_normalize([axis[0], axis[1], axis[2], w])
}

/// Splits `q` into rotation about `axis` (twist) and the remainder (swing),
/// such that `q == swing * twist`.
pub fn swing_twist_decompose(q: Quat, axis: Vec3) -> (Quat, Quat) {
    let a = match normalize(axis) {
        Some(a) => a,
        None => return (quat_normalize(q), IDENTITY),
    };
    let projection = dot([q[0], q[1], q[2]], a);
    let twist = quat_normalize([a[0] * projection, a[1] * projection, a[2] * projection, q[3]]);
    let swing = quat_mul(q, quat_conjugate(twist));
    (quat_normalize(swing), twist)
}

/// Signed rotation angle about `axis` carried by `q`, in radians.
pub fn twist_angle(q: Quat, axis: Vec3) -> f64 {
    let (_, twist) = swing_twist_decompose(q, axis);
    let a = match normalize(axis) {
        Some(a) => a,
        None => return 0.0,
    };
    let sign = if dot([twist[0], twist[1], twist[2]], a) < 0.0 {
        -1.0
    } else {
        1.0
    };
    let w = twist[3].abs().clamp(-1.0, 1.0);
    2.0 * w.acos() * sign
}

#[cfg(test)]
mod tests {
    use super::*;
    use approx::assert_relative_eq;
    use std::f64::consts::{FRAC_PI_2, PI};

    fn assert_vec_eq(a: Vec3, b: Vec3, eps: f64) {
        for i in 0..3 {
            assert_relative_eq!(a[i], b[i], epsilon = eps);
        }
    }

    #[test]
    fn shortest_arc_of_identical_vectors_is_identity() {
        let q = shortest_arc([0.0, 1.0, 0.0], [0.0, 1.0, 0.0]);
        assert_relative_eq!(q[3].abs(), 1.0, epsilon = 1e-9);
    }

    #[test]
    fn shortest_arc_rotates_y_onto_x() {
        let q = shortest_arc([0.0, 1.0, 0.0], [1.0, 0.0, 0.0]);
        assert_vec_eq(quat_rotate(q, [0.0, 1.0, 0.0]), [1.0, 0.0, 0.0], 1e-9);
    }

    #[test]
    fn shortest_arc_handles_the_antiparallel_case_without_nan() {
        let q = shortest_arc([0.0, 1.0, 0.0], [0.0, -1.0, 0.0]);
        assert!(q.iter().all(|v| v.is_finite()), "got NaN: {q:?}");
        assert_vec_eq(quat_rotate(q, [0.0, 1.0, 0.0]), [0.0, -1.0, 0.0], 1e-6);
    }

    #[test]
    fn shortest_arc_is_the_shortest_path() {
        // Rotating Y to X should be 90 degrees, never 270.
        let q = shortest_arc([0.0, 1.0, 0.0], [1.0, 0.0, 0.0]);
        let angle = 2.0 * q[3].abs().clamp(-1.0, 1.0).acos();
        assert_relative_eq!(angle, FRAC_PI_2, epsilon = 1e-9);
    }

    #[test]
    fn decomposition_recomposes_to_the_original() {
        let q = quat_mul(
            quat_from_axis_angle([0.0, 0.0, 1.0], 0.7),
            quat_from_axis_angle([0.0, 1.0, 0.0], 1.1),
        );
        let axis = [0.0, 1.0, 0.0];
        let (swing, twist) = swing_twist_decompose(q, axis);
        let recomposed = quat_mul(swing, twist);
        let sign = if recomposed[3] * q[3] < 0.0 { -1.0 } else { 1.0 };
        for i in 0..4 {
            assert_relative_eq!(recomposed[i] * sign, q[i], epsilon = 1e-9);
        }
    }

    #[test]
    fn pure_twist_has_no_swing() {
        let axis = [0.0, 1.0, 0.0];
        let q = quat_from_axis_angle(axis, 0.9);
        let (swing, twist) = swing_twist_decompose(q, axis);
        assert_relative_eq!(swing[3].abs(), 1.0, epsilon = 1e-9);
        assert_relative_eq!(twist_angle(twist, axis).abs(), 0.9, epsilon = 1e-9);
    }

    #[test]
    fn pure_swing_has_no_twist() {
        let axis = [0.0, 1.0, 0.0];
        // Rotation about X carries no rotation about Y.
        let q = quat_from_axis_angle([1.0, 0.0, 0.0], 0.6);
        assert_relative_eq!(twist_angle(q, axis), 0.0, epsilon = 1e-9);
    }

    #[test]
    fn twist_angle_is_signed() {
        let axis = [0.0, 1.0, 0.0];
        let pos = quat_from_axis_angle(axis, 0.5);
        let neg = quat_from_axis_angle(axis, -0.5);
        assert!(twist_angle(pos, axis) > 0.0);
        assert!(twist_angle(neg, axis) < 0.0);
        assert_relative_eq!(
            twist_angle(pos, axis),
            -twist_angle(neg, axis),
            epsilon = 1e-9
        );
    }

    #[test]
    fn rotation_composition_order_is_apply_b_then_a() {
        let rx = quat_from_axis_angle([1.0, 0.0, 0.0], FRAC_PI_2);
        let ry = quat_from_axis_angle([0.0, 1.0, 0.0], FRAC_PI_2);
        let combined = quat_mul(rx, ry);
        let stepwise = quat_rotate(rx, quat_rotate(ry, [0.0, 0.0, 1.0]));
        assert_vec_eq(quat_rotate(combined, [0.0, 0.0, 1.0]), stepwise, 1e-9);
    }

    #[test]
    fn conjugate_undoes_a_rotation() {
        let q = quat_from_axis_angle([0.3, 0.5, 0.8], 1.2);
        let v = [0.2, -0.7, 0.4];
        assert_vec_eq(quat_rotate(quat_conjugate(q), quat_rotate(q, v)), v, 1e-9);
    }

    #[test]
    fn half_turn_about_y_maps_z_to_negative_z() {
        let q = quat_from_axis_angle([0.0, 1.0, 0.0], PI);
        assert_vec_eq(quat_rotate(q, [0.0, 0.0, 1.0]), [0.0, 0.0, -1.0], 1e-9);
    }
}
