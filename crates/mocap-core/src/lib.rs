//! `mocap-core` — the Rust/WASM compute core for the webcam mocap studio.
//!
//! Everything numerically hot or precision-sensitive lives here rather than in
//! TypeScript: smoothing filters, image preprocessing, the pose binary format
//! reader, the target skeleton, retargeting, and motion export. The web app
//! reaches all of it through the `#[wasm_bindgen]` surface re-exported below and
//! mirrored by hand in `packages/mocap-core-wasm/index.d.ts`.
//!
//! Module map:
//!
//! - [`filter`] — One Euro smoothing, 1D and multi-joint.
//! - [`image`] — letterbox resize used to feed fixed-size model inputs.
//! - [`pose_format`] — reader for the `WMOC` v1 binary pose take.
//! - [`skeleton`] — the 21-joint T-pose target humanoid (mirrors `@wms/skeleton`).
//! - [`retarget`] — 3D keypoints to joint rotations, via swing/twist.
//! - [`export`] — BVH writer.
//!
//! The crate is `no_std`-hostile on purpose: it assumes an allocator and targets
//! both `wasm32-unknown-unknown` (shipped) and the host (tests).

use wasm_bindgen::prelude::*;

pub mod export;
pub mod filter;
pub mod image;
pub mod pose_format;
pub mod retarget;
pub mod skeleton;

// Re-export the wasm-facing surface at the crate root so `wasm-bindgen` emits a
// flat JS module and callers write `import { OneEuroFilter } from '@wms/mocap-core-wasm'`
// rather than reaching through module paths that do not survive the bindgen step.
pub use export::bvh::{BvhClip, BvhUnits};
pub use filter::multi_joint::MultiJointOneEuro;
pub use filter::one_euro::OneEuroFilter;
pub use image::{resize_letterbox, LetterboxResult};
pub use pose_format::PoseTakeHandle;
pub use retarget::{retarget_pose, SourceConvention};

/// Sanity function proving the JS <-> WASM numeric round trip: `ping(21) == 42`.
///
/// Kept deliberately trivial — the diagnostics panel calls it to distinguish
/// "WASM failed to instantiate" from "WASM loaded but a real call misbehaved".
#[wasm_bindgen]
pub fn ping(x: i32) -> i32 {
    x * 2
}

/// Version of this crate, surfaced in the diagnostics panel.
#[wasm_bindgen]
pub fn core_version() -> String {
    env!("CARGO_PKG_VERSION").to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ping_doubles() {
        assert_eq!(ping(21), 42);
    }

    #[test]
    fn core_version_is_non_empty() {
        assert!(!core_version().is_empty());
    }
}
