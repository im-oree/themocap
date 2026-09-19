# Benchmarks

> **STATUS: NO MEASUREMENTS RECORDED YET.**
>
> This file intentionally contains **no numbers**. Document 1's acceptance criteria
> §12.7 requires _real, dated, machine-specified_ results, and none could be
> produced in the environment where this repository was scaffolded (no network
> access to model hosts, no Rust toolchain, no browser — see
> `docs/decisions.md` → "Open blocker").
>
> Placeholder numbers are worse than no numbers: they would be copied forward into
> `docs/decisions.md` and used to justify model choices that were never measured.
> So the tables below are empty templates, and Document 2 remains blocked.

## How to produce these numbers

1. `pnpm dev:bench` → <http://localhost:5174>
2. Ensure the fixture clips exist (`tools/bench/fixtures/README.md`) and the
   candidate models are acquired (`docs/decisions.md` → "Model acquisition
   procedure").
3. Pick a preset or a single model, pick a backend, press **Run benchmark**.
   Three passes run automatically; the first is discarded as warm-up.
4. Press **Copy Markdown** and paste the result under the matching heading below.
   Do not retype numbers by hand.
5. For the provider comparison press **WASM vs WebGPU**, which runs both and emits
   the agreement table.
6. Watch Activity Monitor during the heaviest refine run and record the OS-level
   peak next to the in-app figure.

Every table must be preceded by the environment block the exporter emits (date,
user agent, core count, `crossOriginIsolated`). **Record the machine.** A number
without a machine is not a measurement.

## Measurement protocol

- 3 passes per configuration, first discarded (JIT/cache warm-up).
- FPS is raw uncapped throughput, not realtime playback pacing — this measures
  model _capacity_.
- Frame time is measured around `session.run()` only. Preprocessing is excluded
  and measured separately; production preprocessing moves to Rust/WASM in
  Document 2, so bench-side TS preprocessing cost is not predictive.
- Peak memory: report both `performance.memory` (Chrome-only, approximate) and
  Activity Monitor resident size. See `docs/decisions.md` → "Memory measurement
  caveat".
- Agreement: ≥30 sampled frames, per-keypoint pixel distance, mean and max.

---

## Live path — 640×480 — _machine TBD_

<!-- environment block goes here -->

| Model                      | Backend | Precision | FPS (avg) | p10 ms | p50 ms | p90 ms | Load time | Peak mem |
| -------------------------- | ------- | --------- | --------- | ------ | ------ | ------ | --------- | -------- |
| RTMDet-nano                | wasm    | int8      | —         | —      | —      | —      | —         | —        |
| RTMDet-nano                | wasm    | fp16      | —         | —      | —      | —      | —         | —        |
| RTMPose-tiny               | wasm    | fp16      | —         | —      | —      | —      | —         | —        |
| RTMPose-tiny               | wasm    | int8      | —         | —      | —      | —      | —         | —        |
| BlazePose 3D world         | wasm    | fp16      | —         | —      | —      | —      | —         | —        |
| **Combined live pipeline** | wasm    | —         | —         | —      | —      | —      | —         | —        |

Repeat the whole table for `webgpu`.

**Target:** ≥24 fps combined. **Result:** _not yet measured._

---

## Refine path — 1920×1080 — _machine TBD_

| Model                        | Backend | Precision | FPS (avg) | p10 ms | p50 ms | p90 ms | Load time | Peak mem |
| ---------------------------- | ------- | --------- | --------- | ------ | ------ | ------ | --------- | -------- |
| RTMPose-l                    | wasm    | fp16      | —         | —      | —      | —      | —         | —        |
| ViTPose-B                    | wasm    | fp16      | —         | —      | —      | —      | —         | —        |
| MotionBERT-lite              | wasm    | fp16      | —         | —      | —      | —      | —         | —        |
| **Combined refine pipeline** | wasm    | —         | —         | —      | —      | —      | —         | —        |

**Targets:** ≥3 fps, <3 GB peak. **Result:** _not yet measured._

---

## Depth support — 1920×1080 — _machine TBD_

| Model                   | Backend | Precision | FPS (avg) | p90 ms | Load time | Peak mem |
| ----------------------- | ------- | --------- | --------- | ------ | --------- | -------- |
| Depth Anything V2 Small | wasm    | fp16      | —         | —      | —         | —        |
| Depth Anything V2 Small | wasm    | int8      | —         | —      | —         | —        |

---

## WASM vs WebGPU numerical agreement

| Model | Frames compared | Keypoints | Mean distance (px) | Max distance (px) |
| ----- | --------------- | --------- | ------------------ | ----------------- |
| —     | —               | —         | —                  | —                 |

**Tolerance decision:** _to be written once measured._ Record the agreed
acceptable max deviation and what happens when a model exceeds it (pin that model
to one provider, or accept the divergence and document it).

---

## Safari vs Chrome

| Observation                     | Chrome    | Safari      |
| ------------------------------- | --------- | ----------- |
| WebGPU available                | —         | —           |
| `performance.memory`            | available | unavailable |
| `crossOriginIsolated`           | —         | —           |
| Threads / `hardwareConcurrency` | —         | —           |
| Notable failures or quirks      | —         | —           |
