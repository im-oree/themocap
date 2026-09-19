# Licenses

Every model, font, and notable runtime dependency that ships or is under
consideration, with its license.

**Hard constraint (master spec, Phases 0–5):** nothing non-commercial, nothing
SMPL-encumbered. SMPL, SMPL-X, SMPL+H, STAR and any model whose weights are derived
from them are **excluded** — their licenses forbid commercial use and require
separate registration. This rules out most published "mesh recovery" checkpoints
(VIBE, SPIN, PARE, HybrIK, CLIFF, and similar). The mesh-regressor stretch goal in
Document 7 must therefore use a non-SMPL body model or remain unshipped.

---

## ⚠️ Verification status

The table below records the licenses of the upstream **projects** as published by
those projects. Per `docs/decisions.md` → "Model acquisition procedure" step 3, a
row is only fully verified once a human has **read the actual `LICENSE` file at the
recorded commit** of the repo the weights came from, and set
`provenance.licenseVerified: true` in `packages/models/manifest.json`.

Because no model files could be downloaded in the environment where this repo was
scaffolded (see `docs/decisions.md` → "Open blocker"), **the per-checkpoint
verification step has not been performed for any row.** Treat the "License" column
as "expected license, to be confirmed against the downloaded artifact", and confirm
each one as part of acquisition.

This matters more than it sounds: several projects use a permissive code license
while distributing _weights_ under different terms, and Depth Anything V2 varies
license **by model size**.

---

## Models under consideration

| Model                        | Task               | Project                         | License (expected) | License text                            | Confirmed against artifact |
| ---------------------------- | ------------------ | ------------------------------- | ------------------ | --------------------------------------- | -------------------------- |
| RTMDet-nano                  | Person detector    | OpenMMLab MMDetection           | Apache-2.0         | `LICENSE` in open-mmlab/mmdetection     | ☐                          |
| YOLOX-tiny                   | Person detector    | Megvii YOLOX                    | Apache-2.0         | `LICENSE` in Megvii-BaseDetection/YOLOX | ☐                          |
| RTMPose-tiny                 | 2D pose (live)     | OpenMMLab MMPose                | Apache-2.0         | `LICENSE` in open-mmlab/mmpose          | ☐                          |
| RTMPose-m                    | 2D pose            | OpenMMLab MMPose                | Apache-2.0         | `LICENSE` in open-mmlab/mmpose          | ☐                          |
| RTMPose-l                    | 2D pose (refine)   | OpenMMLab MMPose                | Apache-2.0         | `LICENSE` in open-mmlab/mmpose          | ☐                          |
| ViTPose-B                    | 2D pose (refine)   | ViTAE-Transformer/ViTPose       | Apache-2.0         | `LICENSE` in the ViTPose repo           | ☐                          |
| RTMW-x                       | Whole-body 2D pose | OpenMMLab MMPose                | Apache-2.0         | `LICENSE` in open-mmlab/mmpose          | ☐ (deferred)               |
| MediaPipe BlazePose Lite     | 2D pose            | Google MediaPipe                | Apache-2.0         | `LICENSE` in google-ai-edge/mediapipe   | ☐                          |
| BlazePose 3D world landmarks | 3D lift            | Google MediaPipe                | Apache-2.0         | `LICENSE` in google-ai-edge/mediapipe   | ☐                          |
| MotionBERT (lite)            | 3D lift            | Walter0807/MotionBERT           | Apache-2.0         | `LICENSE` in the MotionBERT repo        | ☐                          |
| Depth Anything V2 **Small**  | Depth              | DepthAnything/Depth-Anything-V2 | **Apache-2.0**     | `LICENSE` in the V2 repo                | ☐                          |

### Model-specific cautions

- **Depth Anything V2 — size matters.** Only the **Small** checkpoint is
  Apache-2.0. The **Base and Large** checkpoints are **CC-BY-NC-4.0**
  (non-commercial) and are therefore **excluded by the project constraint**. The
  manifest registers the Small variant only. Do not "upgrade" to Base for quality
  without re-reading the license.
- **MotionBERT.** Code is Apache-2.0. Its checkpoints are trained on **Human3.6M**,
  whose dataset terms are academic-use-only. The trained weights are generally
  treated as separable from the dataset terms, but this is exactly the kind of
  question that needs a human decision recorded here before shipping
  commercially. **Flagged for explicit sign-off during acquisition.**
- **MediaPipe.** The framework and released model bundles are Apache-2.0. Files are
  bundled locally — the MediaPipe JS solutions normally fetch assets from a Google
  CDN at runtime, which this project forbids.
- **OpenMMLab (RTMDet / RTMPose / RTMW).** Apache-2.0 across MMDetection and
  MMPose. Pose models trained on COCO inherit COCO's CC-BY-4.0 image terms, which
  affect the _dataset_, not inference with the weights.
- **ViTPose.** Apache-2.0, but confirm which checkpoint is being taken; some
  variants are MS COCO + AI Challenger trained and the release notes differ per
  checkpoint.

---

## Fonts

| Font       | License                                     | How it ships                                                                                                                                                  |
| ---------- | ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Inter**  | SIL Open Font License 1.1                   | Bundled locally via `@fontsource/inter` (woff2 self-hosted). Redistribution permitted.                                                                        |
| **SF Pro** | Apple proprietary — **not redistributable** | **Never bundled.** Referenced only via `-apple-system` / `BlinkMacSystemFont` in the font stack, which resolves natively on Apple devices with zero download. |

No remote font is ever requested; `scripts/check-no-remote.mjs` enforces this.

---

## Key runtime dependencies

| Dependency       | License           |
| ---------------- | ----------------- |
| onnxruntime-web  | MIT               |
| React / ReactDOM | MIT               |
| Zustand          | MIT               |
| Tailwind CSS     | MIT               |
| Vite             | MIT               |
| wasm-bindgen     | MIT OR Apache-2.0 |
| nalgebra         | Apache-2.0        |
| serde            | MIT OR Apache-2.0 |
| approx           | Apache-2.0        |
| Playwright       | Apache-2.0        |
| Vitest           | MIT               |

`crates/mocap-core` itself is `MIT OR Apache-2.0` (see its `Cargo.toml`).

---

## Fixture clips

Benchmark fixtures in `tools/bench/public/fixtures/` must be **self-recorded** or
permissively licensed, with the source recorded in
`tools/bench/fixtures/README.md`. They are git-ignored; do not commit video.
