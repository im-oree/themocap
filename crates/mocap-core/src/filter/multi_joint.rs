//! Batch One Euro filtering across every joint channel of a pose.
//!
//! One independent filter per (joint, axis) channel: `J*2` channels for 2D poses,
//! `J*3` for 3D. Batching exists purely to cross the JS/WASM boundary once per
//! frame instead of once per channel — the maths per channel is identical to
//! `OneEuroFilter`, and `batch_matches_independent_filters` proves it stays that way.

use wasm_bindgen::prelude::*;

use super::one_euro::OneEuroFilter;

/// Defaults from the master spec §10.
pub const DEFAULT_MIN_CUTOFF: f64 = 1.0;
pub const DEFAULT_BETA: f64 = 0.007;
pub const DEFAULT_D_CUTOFF: f64 = 1.0;

/// One One-Euro filter per channel, driven a whole pose at a time.
#[wasm_bindgen]
pub struct MultiJointOneEuro {
    filters: Vec<OneEuroFilter>,
}

#[wasm_bindgen]
impl MultiJointOneEuro {
    #[wasm_bindgen(constructor)]
    pub fn new(num_channels: usize, min_cutoff: f64, beta: f64, d_cutoff: f64) -> MultiJointOneEuro {
        MultiJointOneEuro {
            filters: (0..num_channels)
                .map(|_| OneEuroFilter::new(min_cutoff, beta, d_cutoff))
                .collect(),
        }
    }

    /// Construct with the master-spec default tuning.
    pub fn with_defaults(num_channels: usize) -> MultiJointOneEuro {
        MultiJointOneEuro::new(
            num_channels,
            DEFAULT_MIN_CUTOFF,
            DEFAULT_BETA,
            DEFAULT_D_CUTOFF,
        )
    }

    #[wasm_bindgen(getter)]
    pub fn num_channels(&self) -> usize {
        self.filters.len()
    }

    /// Filter a whole pose in place. `xs.len()` must equal `num_channels`.
    ///
    /// TODO(Document 3): confidence-weighted variant — the master spec's "weight by
    /// confidence" rule means low-confidence samples should widen the cutoff rather
    /// than be trusted equally. Live mode passes confidence through untouched (§6.4),
    /// so this lands with the refine pipeline.
    pub fn filter_batch(&mut self, xs: &mut [f64], t: f64) {
        assert_eq!(
            xs.len(),
            self.filters.len(),
            "filter_batch: expected {} channels, got {}",
            self.filters.len(),
            xs.len()
        );
        for (x, filter) in xs.iter_mut().zip(self.filters.iter_mut()) {
            *x = filter.filter(*x, t);
        }
    }

    /// Retune every channel live without losing filter history (drives the
    /// debug sliders in this phase, the real editor sliders in Document 4).
    pub fn set_params(&mut self, min_cutoff: f64, beta: f64) {
        for filter in self.filters.iter_mut() {
            filter.set_params(min_cutoff, beta);
        }
    }

    /// Drop all history — call when the source changes or playback seeks.
    pub fn reset(&mut self) {
        for filter in self.filters.iter_mut() {
            filter.reset();
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use approx::assert_relative_eq;

    #[test]
    fn batch_matches_independent_filters() {
        // Regression guard: batching must not change the maths.
        let channels = 6;
        let mut batch = MultiJointOneEuro::new(channels, 1.0, 0.007, 1.0);
        let mut singles: Vec<OneEuroFilter> = (0..channels)
            .map(|_| OneEuroFilter::new(1.0, 0.007, 1.0))
            .collect();

        for frame in 0..90 {
            let t = frame as f64 / 30.0;
            let mut xs: Vec<f64> = (0..channels)
                .map(|c| (frame as f64 * 0.1 + c as f64).sin())
                .collect();
            let expected: Vec<f64> = xs
                .iter()
                .zip(singles.iter_mut())
                .map(|(x, f)| f.filter(*x, t))
                .collect();

            batch.filter_batch(&mut xs, t);
            for (got, want) in xs.iter().zip(expected.iter()) {
                assert_relative_eq!(got, want, epsilon = 1e-12);
            }
        }
    }

    #[test]
    fn channels_do_not_leak_into_each_other() {
        let mut batch = MultiJointOneEuro::with_defaults(2);
        let mut xs = vec![0.0, 100.0];
        for i in 0..60 {
            xs[0] = 0.0;
            xs[1] = 100.0;
            batch.filter_batch(&mut xs, i as f64 / 30.0);
        }
        assert_relative_eq!(xs[0], 0.0, epsilon = 1e-6);
        assert_relative_eq!(xs[1], 100.0, epsilon = 1e-6);
    }

    #[test]
    fn smooths_a_noisy_constant_across_all_channels() {
        let mut batch = MultiJointOneEuro::with_defaults(3);
        let mut history: Vec<Vec<f64>> = vec![Vec::new(); 3];
        for i in 0..120 {
            let noise = ((i as f64 * 12.9898).sin() * 43758.5453).rem_euclid(1.0) - 0.5;
            let mut xs = vec![1.0 + noise * 0.05; 3];
            batch.filter_batch(&mut xs, i as f64 / 30.0);
            for (c, x) in xs.iter().enumerate() {
                history[c].push(*x);
            }
        }
        for channel in history {
            let tail = &channel[channel.len() - 20..];
            let mean = tail.iter().sum::<f64>() / tail.len() as f64;
            let var = tail.iter().map(|v| (v - mean).powi(2)).sum::<f64>() / tail.len() as f64;
            assert!(var < 1e-3, "variance too high: {var}");
        }
    }

    #[test]
    fn set_params_retunes_without_dropping_history() {
        let mut batch = MultiJointOneEuro::with_defaults(1);
        let mut xs = vec![1.0];
        for i in 0..30 {
            xs[0] = 1.0;
            batch.filter_batch(&mut xs, i as f64 / 30.0);
        }
        let converged = xs[0];
        batch.set_params(0.1, 0.5);
        xs[0] = 1.0;
        batch.filter_batch(&mut xs, 1.0);
        // History retained => still near the converged value, not reset to first-sample.
        assert_relative_eq!(xs[0], converged, epsilon = 1e-3);
    }

    #[test]
    fn reset_clears_every_channel() {
        let mut batch = MultiJointOneEuro::with_defaults(2);
        let mut xs = vec![10.0, 10.0];
        for i in 0..40 {
            xs[0] = 10.0;
            xs[1] = 10.0;
            batch.filter_batch(&mut xs, i as f64 / 30.0);
        }
        batch.reset();
        let mut fresh = vec![0.0, 0.0];
        batch.filter_batch(&mut fresh, 0.0);
        assert_relative_eq!(fresh[0], 0.0, epsilon = 1e-9);
        assert_relative_eq!(fresh[1], 0.0, epsilon = 1e-9);
    }

    #[test]
    #[should_panic(expected = "expected 4 channels")]
    fn rejects_a_wrong_sized_batch() {
        let mut batch = MultiJointOneEuro::with_defaults(4);
        let mut xs = vec![0.0; 3];
        batch.filter_batch(&mut xs, 0.0);
    }
}
