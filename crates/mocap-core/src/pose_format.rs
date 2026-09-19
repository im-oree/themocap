//! Reader for the `raw-keypoints.bin` take format (Document 2 §11.3).
//!
//! The *writer* is TypeScript (`TakeWriter.ts`) because it is data marshalling in
//! the recording path, not a compute kernel — the same exemption Document 1 granted
//! bench preprocessing, recorded in `docs/decisions.md`. The *reader* is here
//! because both this phase's retarget/export step and Document 3's refine pipeline
//! consume it from inside WASM.
//!
//! ```text
//! Header (little-endian):
//!   u32 magic = 0x574D4F43  ("WMOC" read as bytes C,O,M,W -> see MAGIC)
//!   u16 version = 1
//!   u32 frameCount
//!   u32 jointCount
//!   f32 fps
//! Per frame:
//!   f64 t
//!   f32[jointCount*2] kp2d
//!   u8  has3d
//!   f32[jointCount*3] kp3d     // only when has3d == 1
//!   f32[jointCount]   conf
//! ```
//!
//! The header is deliberately unpadded: fields are read at explicit byte offsets,
//! so there is no struct-alignment ambiguity between the TS writer and this reader.

use wasm_bindgen::prelude::*;

pub const MAGIC: u32 = 0x574D_4F43;
pub const VERSION: u16 = 1;
/// u32 magic + u16 version + u32 frameCount + u32 jointCount + f32 fps
pub const HEADER_BYTES: usize = 4 + 2 + 4 + 4 + 4;

#[derive(Debug, Clone, PartialEq)]
pub enum PoseFormatError {
    TooShort { need: usize, got: usize },
    BadMagic(u32),
    UnsupportedVersion(u16),
    Truncated { frame: usize },
    InvalidHas3d { frame: usize, value: u8 },
}

impl core::fmt::Display for PoseFormatError {
    fn fmt(&self, f: &mut core::fmt::Formatter<'_>) -> core::fmt::Result {
        match self {
            PoseFormatError::TooShort { need, got } => {
                write!(f, "buffer too short: need {need} bytes, got {got}")
            }
            PoseFormatError::BadMagic(m) => write!(f, "bad magic 0x{m:08X}, expected 0x574D4F43"),
            PoseFormatError::UnsupportedVersion(v) => write!(f, "unsupported version {v}"),
            PoseFormatError::Truncated { frame } => write!(f, "truncated at frame {frame}"),
            PoseFormatError::InvalidHas3d { frame, value } => {
                write!(f, "frame {frame}: has3d must be 0 or 1, got {value}")
            }
        }
    }
}

/// One decoded frame of source-skeleton keypoints.
#[derive(Debug, Clone, PartialEq)]
pub struct PoseFrame {
    pub t: f64,
    pub kp2d: Vec<f32>,
    /// Empty when the frame carried no 3D estimate.
    pub kp3d: Vec<f32>,
    pub conf: Vec<f32>,
}

impl PoseFrame {
    pub fn has_3d(&self) -> bool {
        !self.kp3d.is_empty()
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct PoseTake {
    pub fps: f32,
    pub joint_count: usize,
    pub frames: Vec<PoseFrame>,
}

struct Cursor<'a> {
    bytes: &'a [u8],
    pos: usize,
}

impl<'a> Cursor<'a> {
    fn take(&mut self, n: usize) -> Option<&'a [u8]> {
        let end = self.pos.checked_add(n)?;
        let slice = self.bytes.get(self.pos..end)?;
        self.pos = end;
        Some(slice)
    }

    fn u8(&mut self) -> Option<u8> {
        Some(self.take(1)?[0])
    }

    fn u16(&mut self) -> Option<u16> {
        Some(u16::from_le_bytes(self.take(2)?.try_into().ok()?))
    }

    fn u32(&mut self) -> Option<u32> {
        Some(u32::from_le_bytes(self.take(4)?.try_into().ok()?))
    }

    fn f32(&mut self) -> Option<f32> {
        Some(f32::from_le_bytes(self.take(4)?.try_into().ok()?))
    }

    fn f64(&mut self) -> Option<f64> {
        Some(f64::from_le_bytes(self.take(8)?.try_into().ok()?))
    }

    fn f32_vec(&mut self, n: usize) -> Option<Vec<f32>> {
        let raw = self.take(n * 4)?;
        Some(
            raw.chunks_exact(4)
                .map(|c| f32::from_le_bytes([c[0], c[1], c[2], c[3]]))
                .collect(),
        )
    }
}

/// Parses a complete `raw-keypoints.bin` buffer.
pub fn parse_pose_take(bytes: &[u8]) -> Result<PoseTake, PoseFormatError> {
    if bytes.len() < HEADER_BYTES {
        return Err(PoseFormatError::TooShort {
            need: HEADER_BYTES,
            got: bytes.len(),
        });
    }
    let mut cur = Cursor { bytes, pos: 0 };

    let magic = cur.u32().expect("header length checked");
    if magic != MAGIC {
        return Err(PoseFormatError::BadMagic(magic));
    }
    let version = cur.u16().expect("header length checked");
    if version != VERSION {
        return Err(PoseFormatError::UnsupportedVersion(version));
    }
    let frame_count = cur.u32().expect("header length checked") as usize;
    let joint_count = cur.u32().expect("header length checked") as usize;
    let fps = cur.f32().expect("header length checked");

    let mut frames = Vec::with_capacity(frame_count.min(4096));
    for frame in 0..frame_count {
        let t = cur.f64().ok_or(PoseFormatError::Truncated { frame })?;
        let kp2d = cur
            .f32_vec(joint_count * 2)
            .ok_or(PoseFormatError::Truncated { frame })?;
        let has3d = cur.u8().ok_or(PoseFormatError::Truncated { frame })?;
        let kp3d = match has3d {
            0 => Vec::new(),
            1 => cur
                .f32_vec(joint_count * 3)
                .ok_or(PoseFormatError::Truncated { frame })?,
            value => return Err(PoseFormatError::InvalidHas3d { frame, value }),
        };
        let conf = cur
            .f32_vec(joint_count)
            .ok_or(PoseFormatError::Truncated { frame })?;
        frames.push(PoseFrame {
            t,
            kp2d,
            kp3d,
            conf,
        });
    }

    Ok(PoseTake {
        fps,
        joint_count,
        frames,
    })
}

/// WASM-facing handle so JS can inspect a take without copying every frame.
#[wasm_bindgen]
pub struct PoseTakeHandle {
    take: PoseTake,
}

#[wasm_bindgen]
impl PoseTakeHandle {
    /// Parses a take buffer, throwing a descriptive JS error on malformed input.
    pub fn parse(bytes: &[u8]) -> Result<PoseTakeHandle, JsError> {
        match parse_pose_take(bytes) {
            Ok(take) => Ok(PoseTakeHandle { take }),
            Err(e) => Err(JsError::new(&e.to_string())),
        }
    }

    #[wasm_bindgen(getter)]
    pub fn frame_count(&self) -> usize {
        self.take.frames.len()
    }

    #[wasm_bindgen(getter)]
    pub fn joint_count(&self) -> usize {
        self.take.joint_count
    }

    #[wasm_bindgen(getter)]
    pub fn fps(&self) -> f32 {
        self.take.fps
    }

    pub fn timestamp(&self, frame: usize) -> Option<f64> {
        self.take.frames.get(frame).map(|f| f.t)
    }

    pub fn kp2d(&self, frame: usize) -> Option<Vec<f32>> {
        self.take.frames.get(frame).map(|f| f.kp2d.clone())
    }

    pub fn kp3d(&self, frame: usize) -> Option<Vec<f32>> {
        self.take
            .frames
            .get(frame)
            .filter(|f| f.has_3d())
            .map(|f| f.kp3d.clone())
    }

    pub fn conf(&self, frame: usize) -> Option<Vec<f32>> {
        self.take.frames.get(frame).map(|f| f.conf.clone())
    }
}

impl PoseTakeHandle {
    pub fn take(&self) -> &PoseTake {
        &self.take
    }
}

#[cfg(test)]
pub(crate) mod test_support {
    use super::*;

    /// Mirror of the TypeScript writer, used to test the reader in isolation.
    /// The cross-language parity test lives in `apps/web/tests/unit/poseFormat.test.ts`.
    pub fn encode(take: &PoseTake) -> Vec<u8> {
        let mut out = Vec::new();
        out.extend_from_slice(&MAGIC.to_le_bytes());
        out.extend_from_slice(&VERSION.to_le_bytes());
        out.extend_from_slice(&(take.frames.len() as u32).to_le_bytes());
        out.extend_from_slice(&(take.joint_count as u32).to_le_bytes());
        out.extend_from_slice(&take.fps.to_le_bytes());
        for frame in &take.frames {
            out.extend_from_slice(&frame.t.to_le_bytes());
            for v in &frame.kp2d {
                out.extend_from_slice(&v.to_le_bytes());
            }
            out.push(if frame.has_3d() { 1 } else { 0 });
            for v in &frame.kp3d {
                out.extend_from_slice(&v.to_le_bytes());
            }
            for v in &frame.conf {
                out.extend_from_slice(&v.to_le_bytes());
            }
        }
        out
    }

    pub fn sample_take(frames: usize, joints: usize, with_3d: bool) -> PoseTake {
        PoseTake {
            fps: 30.0,
            joint_count: joints,
            frames: (0..frames)
                .map(|f| PoseFrame {
                    t: f as f64 / 30.0,
                    kp2d: (0..joints * 2).map(|i| (f * 100 + i) as f32 * 0.5).collect(),
                    kp3d: if with_3d {
                        (0..joints * 3).map(|i| (f * 10 + i) as f32 * 0.25).collect()
                    } else {
                        Vec::new()
                    },
                    conf: (0..joints).map(|i| ((i % 10) as f32) / 10.0).collect(),
                })
                .collect(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::test_support::{encode, sample_take};
    use super::*;

    #[test]
    fn round_trips_a_take_with_3d() {
        let take = sample_take(7, 17, true);
        let parsed = parse_pose_take(&encode(&take)).expect("parse");
        assert_eq!(parsed, take);
        assert_eq!(parsed.frames.len(), 7);
        assert_eq!(parsed.joint_count, 17);
        assert_eq!(parsed.fps, 30.0);
    }

    #[test]
    fn round_trips_a_take_without_3d() {
        let take = sample_take(4, 17, false);
        let parsed = parse_pose_take(&encode(&take)).expect("parse");
        assert_eq!(parsed, take);
        assert!(parsed.frames.iter().all(|f| !f.has_3d()));
    }

    #[test]
    fn handles_an_empty_take() {
        let take = PoseTake {
            fps: 30.0,
            joint_count: 17,
            frames: Vec::new(),
        };
        let parsed = parse_pose_take(&encode(&take)).expect("parse");
        assert_eq!(parsed.frames.len(), 0);
    }

    #[test]
    fn mixed_has3d_frames_decode_independently() {
        let mut take = sample_take(3, 5, true);
        take.frames[1].kp3d.clear();
        let parsed = parse_pose_take(&encode(&take)).expect("parse");
        assert!(parsed.frames[0].has_3d());
        assert!(!parsed.frames[1].has_3d());
        assert!(parsed.frames[2].has_3d());
    }

    #[test]
    fn rejects_a_bad_magic() {
        let mut bytes = encode(&sample_take(1, 2, false));
        bytes[0] ^= 0xFF;
        assert!(matches!(
            parse_pose_take(&bytes),
            Err(PoseFormatError::BadMagic(_))
        ));
    }

    #[test]
    fn rejects_an_unsupported_version() {
        let mut bytes = encode(&sample_take(1, 2, false));
        bytes[4] = 99;
        assert_eq!(
            parse_pose_take(&bytes),
            Err(PoseFormatError::UnsupportedVersion(99))
        );
    }

    #[test]
    fn rejects_a_truncated_buffer_instead_of_panicking() {
        let bytes = encode(&sample_take(5, 17, true));
        let cut = &bytes[..bytes.len() - 10];
        assert!(matches!(
            parse_pose_take(cut),
            Err(PoseFormatError::Truncated { .. })
        ));
    }

    #[test]
    fn rejects_a_short_header() {
        assert!(matches!(
            parse_pose_take(&[0, 1, 2]),
            Err(PoseFormatError::TooShort { .. })
        ));
    }

    #[test]
    fn rejects_an_invalid_has3d_flag() {
        let take = sample_take(1, 2, false);
        let mut bytes = encode(&take);
        // has3d sits after the header, the f64 timestamp and kp2d.
        let idx = HEADER_BYTES + 8 + 2 * 2 * 4;
        bytes[idx] = 7;
        assert_eq!(
            parse_pose_take(&bytes),
            Err(PoseFormatError::InvalidHas3d { frame: 0, value: 7 })
        );
    }

    #[test]
    fn header_layout_is_exactly_eighteen_bytes() {
        // Guards against accidental padding drift between writer and reader.
        assert_eq!(HEADER_BYTES, 18);
        let bytes = encode(&PoseTake {
            fps: 60.0,
            joint_count: 3,
            frames: Vec::new(),
        });
        assert_eq!(bytes.len(), HEADER_BYTES);
    }
}
