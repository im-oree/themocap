//! 1D One Euro filter (Casiez et al., 2012) — the smoothing primitive the whole
//! pipeline is built on. The multi-joint batch wrapper lives in `multi_joint.rs`.

use wasm_bindgen::prelude::*;

/// Smoothing factor for a first-order low-pass filter at `cutoff` Hz over `dt` seconds.
pub(crate) fn alpha(cutoff: f64, dt: f64) -> f64 {
    let tau = 1.0 / (2.0 * std::f64::consts::PI * cutoff);
    1.0 / (1.0 + tau / dt)
}

pub(crate) fn low_pass(x: f64, x_prev: f64, a: f64) -> f64 {
    a * x + (1.0 - a) * x_prev
}

/// 1D One Euro filter (Casiez et al., 2012).
#[wasm_bindgen]
pub struct OneEuroFilter {
    min_cutoff: f64,
    beta: f64,
    d_cutoff: f64,
    x_prev: Option<f64>,
    dx_prev: f64,
    t_prev: Option<f64>,
}

#[wasm_bindgen]
impl OneEuroFilter {
    /// `min_cutoff` Hz sets baseline smoothing; `beta` trades lag for jitter on fast motion.
    #[wasm_bindgen(constructor)]
    pub fn new(min_cutoff: f64, beta: f64, d_cutoff: f64) -> OneEuroFilter {
        OneEuroFilter {
            min_cutoff,
            beta,
            d_cutoff,
            x_prev: None,
            dx_prev: 0.0,
            t_prev: None,
        }
    }

    /// Filter sample `x` observed at timestamp `t` (seconds). Returns the smoothed value.
    pub fn filter(&mut self, x: f64, t: f64) -> f64 {
        let dt = match self.t_prev {
            Some(tp) => (t - tp).max(1e-6),
            None => 1.0 / 30.0,
        };
        let dx = match self.x_prev {
            Some(xp) => (x - xp) / dt,
            None => 0.0,
        };
        let edx = low_pass(dx, self.dx_prev, alpha(self.d_cutoff, dt));
        self.dx_prev = edx;
        let cutoff = self.min_cutoff + self.beta * edx.abs();
        let ex = low_pass(x, self.x_prev.unwrap_or(x), alpha(cutoff, dt));
        self.x_prev = Some(ex);
        self.t_prev = Some(t);
        ex
    }

    /// Update cutoff parameters live without losing filter history.
    pub fn set_params(&mut self, min_cutoff: f64, beta: f64) {
        self.min_cutoff = min_cutoff;
        self.beta = beta;
    }

    /// Drop all history so the next sample is treated as the first.
    pub fn reset(&mut self) {
        self.x_prev = None;
        self.dx_prev = 0.0;
        self.t_prev = None;
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use approx::assert_relative_eq;

    #[test]
    fn constant_input_converges_to_constant() {
        let mut f = OneEuroFilter::new(1.0, 0.007, 1.0);
        let mut out = 0.0;
        for i in 0..200 {
            out = f.filter(5.0, i as f64 / 30.0);
        }
        assert_relative_eq!(out, 5.0, epsilon = 1e-6);
    }

    #[test]
    fn noisy_constant_is_smoothed() {
        // Deterministic pseudo-noise in [-0.5, 0.5) so the test never flakes.
        // `rem_euclid` (not `fract`) keeps the value non-negative before centering.
        let mut f = OneEuroFilter::new(1.0, 0.007, 1.0);
        let mut outs = Vec::new();
        for i in 0..120 {
            let noise = ((i as f64 * 12.9898).sin() * 43758.5453).rem_euclid(1.0) - 0.5;
            outs.push(f.filter(1.0 + noise * 0.05, i as f64 / 30.0));
        }
        let tail = &outs[outs.len() - 20..];
        let mean = tail.iter().sum::<f64>() / tail.len() as f64;
        let var = tail.iter().map(|v| (v - mean).powi(2)).sum::<f64>() / tail.len() as f64;
        assert!(var < 1e-3, "variance too high: {var}");
    }

    #[test]
    fn step_response_lags_and_higher_beta_tracks_faster() {
        // A step input must be smoothed (output below the step for a while)...
        let mut slow = OneEuroFilter::new(1.0, 0.0, 1.0);
        let mut fast = OneEuroFilter::new(1.0, 5.0, 1.0);
        let mut slow_out = 0.0;
        let mut fast_out = 0.0;
        for i in 0..10 {
            let t = i as f64 / 30.0;
            let x = if i == 0 { 0.0 } else { 1.0 };
            slow_out = slow.filter(x, t);
            fast_out = fast.filter(x, t);
        }
        assert!(slow_out < 1.0, "step was not smoothed: {slow_out}");
        // ...and a larger beta reduces lag, i.e. tracks the step faster.
        assert!(
            fast_out > slow_out,
            "higher beta should reduce lag: fast={fast_out} slow={slow_out}"
        );
    }

    #[test]
    fn reset_clears_history() {
        let mut f = OneEuroFilter::new(1.0, 0.007, 1.0);
        for i in 0..50 {
            f.filter(10.0, i as f64 / 30.0);
        }
        f.reset();
        // First sample after reset is returned with no pull toward the old value.
        assert_relative_eq!(f.filter(0.0, 0.0), 0.0, epsilon = 1e-9);
    }
}
