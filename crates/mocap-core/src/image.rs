//! Image preprocessing kernels.
//!
//! Per the master spec's "no JS fallback for compute kernels" rule, resize and
//! letterbox live here rather than in TypeScript. `tools/bench` has a documented
//! exemption; shipped product code does not.

use wasm_bindgen::prelude::*;

/// Maps letterboxed coordinates back to the source frame, so 2D keypoints
/// predicted on the padded image can be drawn on the original video.
#[wasm_bindgen]
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct LetterboxInfo {
    scale: f64,
    pad_x: f64,
    pad_y: f64,
}

#[wasm_bindgen]
impl LetterboxInfo {
    #[wasm_bindgen(getter)]
    pub fn scale(&self) -> f64 {
        self.scale
    }

    #[wasm_bindgen(getter)]
    pub fn pad_x(&self) -> f64 {
        self.pad_x
    }

    #[wasm_bindgen(getter)]
    pub fn pad_y(&self) -> f64 {
        self.pad_y
    }

    /// Letterboxed pixel coords -> source-frame pixel coords.
    pub fn to_source_x(&self, x: f64) -> f64 {
        (x - self.pad_x) / self.scale
    }

    pub fn to_source_y(&self, y: f64) -> f64 {
        (y - self.pad_y) / self.scale
    }
}

/// Result of a letterbox operation: the RGBA pixels plus the coordinate mapping.
#[wasm_bindgen]
pub struct LetterboxResult {
    data: Vec<u8>,
    info: LetterboxInfo,
}

#[wasm_bindgen]
impl LetterboxResult {
    /// Copies the padded RGBA buffer out to JS.
    #[wasm_bindgen(getter)]
    pub fn data(&self) -> Vec<u8> {
        self.data.clone()
    }

    #[wasm_bindgen(getter)]
    pub fn info(&self) -> LetterboxInfo {
        self.info
    }
}

/// Aspect-preserving resize into `dst_w x dst_h`, centre-padded with black.
///
/// `src` is tightly packed RGBA8 (`src_w * src_h * 4` bytes). Sampling is bilinear,
/// which matters: nearest-neighbour downscaling of a 1080p frame to 640x480 loses
/// enough detail to measurably hurt keypoint accuracy.
pub fn resize_letterbox_rgba(
    src: &[u8],
    src_w: usize,
    src_h: usize,
    dst_w: usize,
    dst_h: usize,
) -> LetterboxResult {
    assert_eq!(
        src.len(),
        src_w * src_h * 4,
        "resize_letterbox: expected {} bytes for {}x{} RGBA, got {}",
        src_w * src_h * 4,
        src_w,
        src_h,
        src.len()
    );
    assert!(src_w > 0 && src_h > 0 && dst_w > 0 && dst_h > 0);

    let scale = f64::min(dst_w as f64 / src_w as f64, dst_h as f64 / src_h as f64);
    let draw_w = ((src_w as f64 * scale).round() as usize).clamp(1, dst_w);
    let draw_h = ((src_h as f64 * scale).round() as usize).clamp(1, dst_h);
    let pad_x = (dst_w - draw_w) / 2;
    let pad_y = (dst_h - draw_h) / 2;

    // Opaque black padding: alpha 255 so downstream models see a valid image.
    let mut out = vec![0u8; dst_w * dst_h * 4];
    for px in out.chunks_exact_mut(4) {
        px[3] = 255;
    }

    for y in 0..draw_h {
        // Pixel-centre mapping avoids the half-pixel shift a naive ratio introduces.
        let sy = ((y as f64 + 0.5) / scale - 0.5).clamp(0.0, (src_h - 1) as f64);
        let y0 = sy.floor() as usize;
        let y1 = (y0 + 1).min(src_h - 1);
        let wy = sy - y0 as f64;

        for x in 0..draw_w {
            let sx = ((x as f64 + 0.5) / scale - 0.5).clamp(0.0, (src_w - 1) as f64);
            let x0 = sx.floor() as usize;
            let x1 = (x0 + 1).min(src_w - 1);
            let wx = sx - x0 as f64;

            let dst_idx = ((y + pad_y) * dst_w + (x + pad_x)) * 4;
            for c in 0..4 {
                let p00 = src[(y0 * src_w + x0) * 4 + c] as f64;
                let p01 = src[(y0 * src_w + x1) * 4 + c] as f64;
                let p10 = src[(y1 * src_w + x0) * 4 + c] as f64;
                let p11 = src[(y1 * src_w + x1) * 4 + c] as f64;
                let top = p00 + (p01 - p00) * wx;
                let bottom = p10 + (p11 - p10) * wx;
                out[dst_idx + c] = (top + (bottom - top) * wy).round().clamp(0.0, 255.0) as u8;
            }
        }
    }

    LetterboxResult {
        data: out,
        info: LetterboxInfo {
            scale,
            pad_x: pad_x as f64,
            pad_y: pad_y as f64,
        },
    }
}

#[wasm_bindgen]
pub fn resize_letterbox(
    src: &[u8],
    src_w: usize,
    src_h: usize,
    dst_w: usize,
    dst_h: usize,
) -> LetterboxResult {
    resize_letterbox_rgba(src, src_w, src_h, dst_w, dst_h)
}

#[cfg(test)]
mod tests {
    use super::*;
    use approx::assert_relative_eq;

    fn solid(w: usize, h: usize, rgba: [u8; 4]) -> Vec<u8> {
        let mut v = Vec::with_capacity(w * h * 4);
        for _ in 0..w * h {
            v.extend_from_slice(&rgba);
        }
        v
    }

    #[test]
    fn identity_resize_preserves_pixels() {
        let src = solid(4, 4, [10, 20, 30, 255]);
        let out = resize_letterbox_rgba(&src, 4, 4, 4, 4);
        assert_eq!(out.data, src);
        assert_relative_eq!(out.info.scale, 1.0);
        assert_relative_eq!(out.info.pad_x, 0.0);
        assert_relative_eq!(out.info.pad_y, 0.0);
    }

    #[test]
    fn pads_vertically_for_a_wider_target() {
        // 1:1 source into a 4:1 target => pillarboxed horizontally.
        let src = solid(10, 10, [255, 0, 0, 255]);
        let out = resize_letterbox_rgba(&src, 10, 10, 40, 10);
        assert_relative_eq!(out.info.scale, 1.0);
        assert_relative_eq!(out.info.pad_x, 15.0);
        assert_relative_eq!(out.info.pad_y, 0.0);

        // Corner is padding, centre is image.
        assert_eq!(&out.data[0..4], &[0, 0, 0, 255]);
        let centre = ((5 * 40) + 20) * 4;
        assert_eq!(&out.data[centre..centre + 4], &[255, 0, 0, 255]);
    }

    #[test]
    fn downscales_1080p_to_the_live_pipeline_resolution() {
        // The real case from §5.4: a 1080p file feeding a 640x480 pipeline.
        let src = solid(192, 108, [7, 9, 11, 255]);
        let out = resize_letterbox_rgba(&src, 192, 108, 64, 48);
        assert_eq!(out.data.len(), 64 * 48 * 4);
        assert_relative_eq!(out.info.scale, 64.0 / 192.0, epsilon = 1e-12);
        // 16:9 into 4:3 letterboxes top and bottom.
        assert!(out.info.pad_y > 0.0);
        assert_relative_eq!(out.info.pad_x, 0.0);
    }

    #[test]
    fn unletterboxing_recovers_source_coordinates() {
        let src = solid(192, 108, [1, 2, 3, 255]);
        let out = resize_letterbox_rgba(&src, 192, 108, 64, 48);
        let info = out.info;
        // A point at the source centre must map back to the source centre.
        let cx = 96.0 * info.scale + info.pad_x;
        let cy = 54.0 * info.scale + info.pad_y;
        assert_relative_eq!(info.to_source_x(cx), 96.0, epsilon = 1e-9);
        assert_relative_eq!(info.to_source_y(cy), 54.0, epsilon = 1e-9);
    }

    #[test]
    fn bilinear_interpolates_a_gradient_rather_than_snapping() {
        // Two-pixel horizontal gradient upscaled: the middle must be blended.
        let mut src = vec![0u8; 2 * 1 * 4];
        src[0] = 0;
        src[4] = 200;
        for p in [3, 7] {
            src[p] = 255;
        }
        let out = resize_letterbox_rgba(&src, 2, 1, 8, 4);
        let row = (out.info.pad_y as usize) * 8 * 4;
        let first = out.data[row] as i32;
        let last = out.data[row + 7 * 4] as i32;
        assert!(first < last, "gradient direction lost: {first} -> {last}");
        // A true nearest-neighbour resize would produce only 0 and 200.
        let mids: Vec<i32> = (1..7).map(|x| out.data[row + x * 4] as i32).collect();
        assert!(
            mids.iter().any(|v| *v != 0 && *v != 200),
            "expected interpolated values, got {mids:?}"
        );
    }

    #[test]
    #[should_panic(expected = "expected")]
    fn rejects_a_mis_sized_source_buffer() {
        let src = vec![0u8; 10];
        resize_letterbox_rgba(&src, 4, 4, 4, 4);
    }
}
