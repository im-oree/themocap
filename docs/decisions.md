# Decisions

Living record of binding technical decisions. Append, don't rewrite: if a decision
changes, add a new dated entry that supersedes the old one and say why.

---

## Status of Document 1

| Area                                                          | Status                             |
| ------------------------------------------------------------- | ---------------------------------- |
| Monorepo, tooling, lint/format/typecheck/CI                   | **Done**                           |
| Design system (`@wms/ui`), Apple-style light/dark shell       | **Done**                           |
| COOP/COEP, network guard, PWA skeleton                        | **Done**                           |
| Interface scaffolding (`inference`, `models`, `skeleton`)     | **Done**                           |
| `crates/mocap-core` source + Rust tests + build script        | **Done (code); compiled in CI)**   |
| Benchmark harness `tools/bench`                               | **Done (harness); no numbers yet** |
| Model acquisition + recorded benchmark numbers + model choice | **BLOCKED — see below**            |

### ⚠️ Open blocker: no benchmark numbers yet

`docs/benchmarks.md` contains **no measured numbers**, and this document therefore
does **not** yet name the models for the live and refine pipelines. That is
Document 1 acceptance criteria §12.6–§12.8, and they are **not met**.

Cause: the development sandbox this repository was scaffolded in has no network
access to `huggingface.co`, `crates.io`, `static.rust-lang.org`, or
`cdn.playwright.dev`, so no model weights could be downloaded, no Rust toolchain
could be installed, and no browser could be provisioned. Fabricating plausible FPS
numbers would defeat the entire purpose of this phase, so nothing was invented.

What exists instead is everything needed to produce those numbers in one sitting on
the target machine: the harness, the provider abstraction, the pipeline presets, the
Markdown exporter, the manifest schema, and the acquisition procedure below. See
"Remaining work to close Document 1".

---

## Toolchain

Pinned so a fresh machine reproduces the environment exactly.

| Tool             | Pin                        | Where pinned                                                                      |
| ---------------- | -------------------------- | --------------------------------------------------------------------------------- |
| Node.js          | 20 LTS                     | `.nvmrc`                                                                          |
| pnpm             | 9.15.4                     | `package.json#packageManager` (via corepack)                                      |
| Rust             | stable (1.78+)             | `rust-toolchain.toml`                                                             |
| wasm32 target    | `wasm32-unknown-unknown`   | `rust-toolchain.toml`                                                             |
| wasm-pack        | 0.13+                      | installed via `cargo install wasm-pack --locked` / `taiki-e/install-action` in CI |
| Vite             | 5.4.x                      | `apps/web`, `tools/bench`                                                         |
| TypeScript       | 5.5+ (strict everywhere)   | `tsconfig.base.json`                                                              |
| ONNX Runtime Web | 1.19.x (wasm + webgpu EPs) | `packages/inference`                                                              |
| Playwright       | 1.45+                      | `apps/web`                                                                        |
| React            | 18.3                       | apps                                                                              |
| Tailwind         | 3.4                        | `packages/ui` preset                                                              |

First-time setup:

```bash
corepack enable && corepack prepare pnpm@9.15.4 --activate
curl https://sh.rustup.rs -sSf | sh -s -- -y
rustup target add wasm32-unknown-unknown
cargo install wasm-pack --locked
pnpm install
pnpm build:wasm      # REQUIRED before `pnpm test` — see "WASM is not optional"
pnpm dev             # app   -> http://localhost:5173
pnpm dev:bench       # bench -> http://localhost:5174
```

**Strict mode is on everywhere**, including `noUncheckedIndexedAccess`. This is
deliberate: the codebase is full of fixed-length keypoint arrays where an
off-by-one is a silent correctness bug rather than a crash.

---

## WASM is not optional

`crates/mocap-core` compiles to WASM and is consumed as `@wms/mocap-core-wasm`.
There is **no JavaScript fallback for compute kernels**.

Two mechanisms make that rule survive contact with reality:

1. **`apps/web/src/lib/mocapCoreUnavailable.ts`** — when `pkg/` has not been built,
   Vite aliases the package to a stub whose every export _throws_. This is not a
   fallback: it exists so a fresh clone boots far enough to display "the compute
   core is missing, run `pnpm build:wasm`" in the diagnostics panel, instead of
   dying with an unresolvable-import build error.
2. **`WMS_REQUIRE_WASM=1`** — set in CI. The WASM bridge test hard-fails if the
   artifact is absent. Locally it reports an actionable skip.

If the bridge test cannot be made green, nothing else in the project should
proceed (Document 1 §5.5).

The hand-written `packages/mocap-core-wasm/index.d.ts` mirrors the Rust
`#[wasm_bindgen]` surface so typechecking works on a clean clone before the wasm
step. It must be kept in sync with `crates/mocap-core/src/lib.rs`; the Rust unit
tests and the Vitest bridge test catch behavioural drift.

---

## Visual direction

- **Typography.** System stack first, so macOS/iOS get real **SF Pro** with zero
  download. **Inter** (SIL OFL 1.1) is bundled locally via `@fontsource/inter` as
  the cross-platform fallback. **SF Pro font files are never bundled** — they are
  not redistributable. There are no remote font requests, ever.
- **Color.** Neutral, high-contrast, restrained; Apple systemBlue accent
  (`#0A84FF`). True-black dark surfaces (`#000` base, `#1C1C1E` elevated), not
  gray-on-gray. Translucent "materials" (`backdrop-blur-xl`) for panels/toolbars.
- **Motion.** 150–220 ms; `cubic-bezier(0.16, 1, 0.3, 1)` for entrances. All motion
  is disabled under `prefers-reduced-motion` via a global rule in `styles.css`.
- **Density.** 8pt spacing scale. Interactive controls are 44px tall (`Button` md/lg,
  `IconButton`, sidebar rows, `Slider`) per Apple HIG. The `sm` button and the
  toolbar's compact icon buttons are deliberate exceptions for dense internal chrome.
- **Accessibility.** Every primitive is keyboard-operable with a visible
  `:focus-visible` ring. `Tooltip` opens on focus, not just hover. Icon-only
  controls require a `label` prop at the type level.

**Theme mechanics.** Tailwind `class` strategy. An inline script in `index.html`
sets the class before first paint (no flash); `packages/ui/src/theme.ts` owns the
runtime store and persists to `localStorage['wms-theme']`. `'system'` is a
first-class persisted choice that subscribes to `matchMedia`, so "follow the OS"
survives reloads rather than decaying into a fixed value.

---

## Hosting requirements (production)

The app is **never** expected to run from `file://`. A static host must send:

```
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Embedder-Policy: require-corp
```

Without cross-origin isolation there is no `SharedArrayBuffer`, therefore no
threaded WASM, therefore no chance of hitting the live-path FPS target.

- Netlify/Cloudflare Pages: `apps/web/public/_headers` (checked in) does this.
- Self-hosting (Caddy):
  ```
  header {
      Cross-Origin-Opener-Policy "same-origin"
      Cross-Origin-Embedder-Policy "require-corp"
  }
  ```
- Dev and `vite preview` set the headers via `apps/web/vite.config.ts`. Both are
  asserted by Playwright (`WMS_E2E_TARGET=preview` runs the suite against the
  built output).

---

## Offline enforcement

Three independent layers, because this is the constraint most likely to regress
silently:

1. **`networkGuard.ts`** patches `fetch`/`XMLHttpRequest` at startup and records
   any non-origin request. `VITE_STRICT_OFFLINE=1` makes it throw; Playwright runs
   with that flag set.
2. **`scripts/check-no-remote.mjs`** (CI, `pnpm check:no-remote`) greps
   `apps/`, `packages/`, `tools/` for `http(s)://`. Exempted: comments, test and
   config files (they name CDNs precisely to assert those URLs are _rejected_),
   `localhost`, SVG/XML namespaces, and documentation-only manifest fields
   (`sourceUrl`, `licenseUrl`, `repo`).
3. **ORT wasm binaries are copied local.** `onnxruntime-web` defaults to a jsDelivr
   CDN. `scripts/copy-ort-assets.mjs` runs on `postinstall`, copies the binaries
   into each app's `public/ort/`, and `ortWebBackend.ts` pins
   `ort.env.wasm.wasmPaths = '/ort/'`. `ortWebBackend.load()` additionally refuses
   any model URL that isn't same-origin.

**Bundle-size note.** `packages/inference` exposes `./capabilities` and `./types`
subpath exports. The app shell imports those instead of the barrel, keeping the
28 MB ORT wasm payload out of the shell bundle (163 kB / 53 kB gzipped) until
Document 2 actually needs inference.

---

## Bench tooling exemption (explicit, not scope creep)

`tools/bench/src/lib/preprocess.ts` does resize/letterbox/normalize **in TypeScript
with typed arrays**. The master spec's "no JS fallback for compute kernels" rule
applies to shipped product code; `tools/bench` is internal tooling, is not shipped,
and is explicitly exempt so the harness can exist before the Rust preprocessing
kernels do.

**Production preprocessing must move to Rust/WASM in Document 2.** This exemption
covers `tools/bench` only. Do not copy that file into `apps/web`. It is flagged in
a file-header comment as well as here so it cannot be mistaken for precedent.

---

## Memory measurement caveat

`performance.memory.usedJSHeapSize` is **Chrome-only and approximate**. It does not
see WASM linear memory allocated outside the JS heap, and it is quantized for
fingerprinting resistance. The harness reports it as "peak heap" and prints `n/a`
elsewhere (notably Safari).

The authoritative number for the `<3GB` acceptance bar is **OS-level resident
memory observed in Activity Monitor** on the M1 target during the heaviest refine
run. Record both, and label which is which, in `docs/benchmarks.md`.

---

## Model acquisition procedure

How a model goes from "found upstream" to "a checksummed local file the bench can
run". This is the repeatable process required by Document 1 §8.2.

1. **Locate an ONNX export.** Prefer a published `.onnx`. If only PyTorch weights
   exist, export with the project's own tooling (MMDeploy `tools/deploy.py` for the
   RTM* family, `tools/export_onnx.py` for YOLOX, `tf2onnx` for the MediaPipe TFLite
   models). Record the exact command in the manifest's `provenance.exportMethod`.
2. **Record provenance.** Upstream repo and the exact commit/tag in
   `provenance.repo` / `provenance.ref`.
3. **Verify the license by reading the actual `LICENSE` file** in the source repo —
   not a summary, not a model-card badge. Only then set
   `provenance.licenseVerified: true` (the manifest validator rejects entries
   without it) and add a row to `docs/licenses.md`.
4. **Place the file** at `tools/bench/public/models/<id>.onnx` (and
   `apps/web/public/models/` once a model is promoted to product use). Both are
   git-ignored — model binaries do not belong in Git.
5. **Checksum and size:**
   ```bash
   shasum -a 256 tools/bench/public/models/<id>.onnx
   stat -f%z  tools/bench/public/models/<id>.onnx   # macOS
   ```
6. **Update the manifest entry**: set `acquired: true`, paste `sha256` and
   `sizeBytes`. The schema forbids a checksum on an unacquired entry and _requires_
   one on an acquired entry, so the two can't drift.
7. **Quantize.** Produce fp16 and/or int8 variants with
   `onnxruntime.quantization` / `onnxconverter-common`, register each as its own
   manifest entry, and bench both precisions — the "quantize where accuracy allows"
   rule is meant to be settled with evidence in this phase.

The bench UI shows a banner counting unacquired models and refuses to invent
results: a run against a missing file fails loudly with the HTTP error.

---

## Remaining work to close Document 1

In order, on the M1 8GB target machine with network access:

1. Install the Rust toolchain; run `cargo test --workspace` and `pnpm build:wasm`;
   confirm the Vitest bridge test passes with `WMS_REQUIRE_WASM=1`.
2. `pnpm --filter @wms/web exec playwright install chromium`; run the E2E suite
   against dev **and** preview.
3. Record the two fixture clips into `tools/bench/public/fixtures/`
   (`walk-640x480.mp4`, `walk-1080p.mp4`) — ~10 s, self-recorded or permissively
   licensed. See `tools/bench/fixtures/README.md`.
4. Acquire every `bench-candidate` model per the procedure above.
5. Run the harness for each candidate × backend × precision, 3 passes, first
   discarded. Use the "Copy Markdown" button to paste results into
   `docs/benchmarks.md` verbatim.
6. Run the WASM-vs-WebGPU A/B on ≥30 sampled frames; record mean/max keypoint
   distance.
7. Repeat in Safari; note provider quirks under "Safari vs Chrome" below.
8. Fill in the "Selected pipelines" section below with the chosen models, measured
   numbers, rejected candidates, and an explicit met/not-met verdict against the
   Phase 0 targets (≥24 fps live, ≥3 fps refine, <3 GB peak, documented
   WASM/WebGPU tolerance). If a target is missed, state the fallback actually taken
   (lighter model / lower resolution / frame-skipping / provider change) and the
   numbers after that fallback. Do not leave an unresolved miss.

---

## Selected pipelines

> **NOT YET DECIDED.** Blocked on the benchmark run above. This section must be
> filled in before any Document 2 work begins, in this form:
>
> **Live pipeline (Document 2 onward):** `<detector>` (`<precision>`) →
> `<2D pose>` (`<precision>`) → `<3D lift>`, `<backend>` provider, 640×480 input,
> measured at NN fps average / NN fps p10 on M1 8GB Chrome NNN — meets / does not
> meet the ≥24 fps bar.
>
> **Refine pipeline (Document 3):** `<2D pose>` → `<3D lift>`, `<backend>`,
> measured at NN fps on M1 8GB, peak memory NN MB (in-app) / NN MB (Activity
> Monitor) — meets / does not meet the ≥3 fps and <3 GB bars.
>
> **Rejected candidates and why:** with the actual number that disqualified each.
>
> **WASM vs WebGPU tolerance:** mean NN px / max NN px over NN sampled frames.

### Provisional expectations (hypotheses, NOT results)

Recorded only so the eventual measurements have something to be checked against;
they carry no authority and must be deleted or confirmed once real numbers exist.

- RTMDet-nano + RTMPose-tiny is the most likely live combination to clear 24 fps on
  an M1 under WASM+SIMD+threads.
- ViTPose-B is the leading memory risk for the refine path on an 8 GB machine.
- WebGPU is expected to win on the larger refine models and possibly _lose_ on the
  tiny live models, where per-op dispatch overhead dominates.
- RTMW (whole-body) is pre-emptively marked `deferred` in the manifest: hands and
  face are not in scope until a later document, so it should not gate this phase.

### Safari vs Chrome

> To be filled during the manual QA pass. Expect at minimum: WebGPU availability
> differences, absence of `performance.memory` in Safari, and differing
> `hardwareConcurrency` reporting.

---

## Smaller decisions

- **Skeletons.** `coco17` is fully correct (it is what the 2D candidates output).
  `h36m17` has the correct canonical joint order and hierarchy but no COCO→H36M
  remap yet (Document 2). `wholebody133` is a stub pending the RTMW decision.
  `targetHumanoid` was a placeholder here in Document 1; it is finalized in
  Document 2 below (21 joints, T-pose, Y-up) now that retargeting has landed.
- **Manifest `acquired` flag.** Added to the spec'd schema. Candidates must be
  listable (so the bench can show what still needs fetching) before their files
  exist, but a _missing_ checksum must never be confusable with a _verified_ one.
- **Service worker.** Present but registered only behind `VITE_ENABLE_SW=1`. Stale
  caches cost more than they save during daily iteration. It precaches the app
  shell only and explicitly skips `/models/` — model caching is OPFS work in
  Document 3, not Cache API work.
- **`allowedHosts: true`** in both Vite configs so the app is reachable from
  sandboxed/remote preview hostnames. Harmless for a local-only dev tool.

---

# Document 2 — live mocap

## Target rig conventions

**Y-up, right-handed, matching Three.js.** `+X` is the character's *left*, the
character faces `-Z`, and all internal lengths are metres. These four statements
bind the retargeter, the rig view, the BVH exporter, and (later) glTF export. They
are asserted in `packages/skeleton/src/targetHumanoid.test.ts` and mirrored in
`crates/mocap-core/src/skeleton.rs`, so the TS and Rust rigs cannot silently drift.

**Rest pose is a T-pose**, not an A-pose. Two reasons:

1. It is what Blender, Unity, and Unreal all assume for humanoid retargeting, so an
   exported BVH drops in without a rest-pose correction step.
2. Every arm bone's rest direction becomes exactly `±X` and every leg bone exactly
   `-Y`. That makes swing-rotation unit tests trivially checkable by hand — a
   90° elbow bend is a literal 90° in the assertion, not an angle relative to some
   arbitrary A-pose offset. The T-pose test in `retarget/mod.rs` ("T-pose in →
   identity rotations out") only works because of this.

The cost is that a T-pose's straight-down-the-side shoulder is a slightly less
natural bind pose for deformation quality. Irrelevant here: we export motion, not
skinned meshes.

**`parents[i] < i`, root parent `-1`.** Topological order is enforced by test. The
Rust retargeter, `forward_kinematics`, and the BVH writer all rely on it to do a
single forward pass with no recursion and no sorting.

**Non-Y-up sources are corrected exactly once**, at the retarget boundary, via
`SourceConvention` (`YUp` / `YDown` / `ZUp`). Nothing downstream of `canonicalize`
is allowed to know that a model emitted Z-up data. Axis bugs that leak past this
boundary are unfindable; keeping the conversion in one named function means there
is exactly one place to look.

### Joint order (21)

`Hips, Spine, Spine1, Neck, Head, LeftShoulder, LeftArm, LeftForeArm, LeftHand,
RightShoulder, RightArm, RightForeArm, RightHand, LeftUpLeg, LeftLeg, LeftFoot,
LeftToeBase, RightUpLeg, RightLeg, RightFoot, RightToeBase`, with parents
`[-1,0,1,2,3,2,5,6,7,2,9,10,11,0,13,14,15,0,17,18,19]` and a rest head height of
≈1.54 m.

**Breaking change from Document 1:** `Chest` was renamed `Spine1`. The Document 1
name had no consumers beyond the placeholder skeleton; `Spine1` is the Mixamo /
Blender-Rigify convention and survives a BVH round-trip into those tools without a
bone-name mapping table.

## BVH exporter

**Channel order is `Zrotation Xrotation Yrotation`** (root additionally prefixed by
`Xposition Yposition Zposition`). ZXY is what Biovision emitted and what Blender's
importer assumes. BVH applies channels in the order they are *listed*, so a local
rotation is `Rz * Rx * Ry`; `quat_to_zxy_euler` inverts precisely that composition
and a round-trip test proves it, including the gimbal-lock branch at `X = ±90°`.

**MOTION values follow depth-first hierarchy order, not joint-index order.** For
the current skeleton these happen to coincide, and a test asserts it — but the
writer goes through `hierarchy_order()` anyway so that adding a joint mid-array
cannot silently scramble every exported clip.

**The root's HIERARCHY `OFFSET` is zero.** `RetargetedFrame::root_pos` is an
absolute world position (the hip centre) and `forward_kinematics` likewise ignores
`REST_OFFSETS[0]` for the root, so emitting the rest offset in *both* the hierarchy
and the position channels would float the whole rig off the ground.

**Default output unit is centimetres** (`BvhUnits::Centimeters`), because that is
what Blender's BVH importer expects at scale 1.0. Only position channels and rest
offsets are scaled; rotations never are.

Leaf joints (Head, both hands, both toes) get an `End Site` extending 10 cm along
their own rest direction, which BVH requires to give the final bone a length.

## `WMOC` v1 binary pose format

Magic `0x574D4F43`, little-endian, **header exactly 18 bytes** and deliberately
unpadded — every offset is computed explicitly by both sides rather than inferred
from struct layout, so the Rust reader can never disagree with the TS writer about
alignment.

The **writer is TypeScript and the reader is Rust.** This inverts the usual "hot
code in Rust" rule and is a deliberate marshalling exemption: the recorder is
already in JS-land holding the pose objects, and shipping every frame across the
WASM boundary purely to serialize it would cost more than the write saves. Parity
is pinned by `apps/web/tests/unit/poseFormat.test.ts` encoding a take that the Rust
`parse_pose_take` tests decode byte-identically.

## Ring buffers

Header is a 4-slot `Int32Array`: `[0] writeIndex`, `[1] slotCount`, `[2] frameIndex
of latest write`, `[3] reserved`. Single writer, single reader, `Atomics` for the
index publish — no locks, and a reader that falls behind drops frames rather than
stalling the producer, which is the correct trade for live preview. Frame ring 4–6
slots, pose ring 3, rig ring 3.

# UI shell

## Docking library: `dockview`

The editor shell needs panels a user can drag, float, tab, resize and close —
Blender/Resolve/Unity behaviour, not a CSS grid with resizable gutters. We use
**`dockview`** (MIT, v8.3.1).

Rejected alternatives:

| Library | Why not |
| --- | --- |
| `react-mosaic` | Binary-split trees only. No floating windows and no tab groups, so "drag Properties on top of Timeline to tab them" is unimplementable. |
| `golden-layout` | The most feature-complete option, but jQuery-era architecture with a bolted-on React wrapper, and its own DOM/lifecycle assumptions fight React 18 StrictMode. |
| `rc-dock` | Genuinely viable and the fallback if `dockview` disappoints. Smaller community, and its styling hooks are less amenable to a full reskin. |

`dockview` wins on serialisable layout state (`toJSON`/`fromJSON` is exactly the
shape §A.6 persistence needs), real floating groups, first-class TypeScript, and
a DOM structure plain enough to restyle completely.

### Containment

Every `dockview` import lives under `packages/ui/src/dock/`. The rest of the app
talks to `DockRoot`, `PanelRegistry` and the `DockController` returned by
`useDockApi` — none of which leak a `dockview` type. Swapping to `rc-dock` would
be a rewrite of four files, not of the application.

### Reskin

The built-in `dockview-theme-*` stylesheets are **not used**. They look like
VS Code, and an app that half-looks-like-VS-Code and half-looks-like-macOS looks
like neither. `packages/ui/src/dock/theme.css` restyles the primitives under a
single `.wms-dock` root using our existing design tokens: 8px radii, hairline
borders, `ease-apple-out` transitions, the SF-adjacent type ramp, and our accent
colour for the active tab. This was treated as core work, not polish — the
docking system is the most visible surface in the app.

## No router

There are no pages and no route navigation. The entire application is one
component tree: menu bar, toolbar, dock, status bar. Anything that would have
been a page is a panel.

This deletes three things from Documents 1–2: the full-page Workspace Picker
(now the Workspace Browser panel's empty state), the two-column live view (now
two independently dockable panels), and the disabled sidebar nav stub. A
navigation affordance that navigates nowhere is worse than no affordance.

## Layout persistence

Per **workspace tab**, not per app: `{ version, layouts: { [tabId]: blob } }`.
Live and Edit are different arrangements for different work, and sharing one
layout between them would make each tab switch feel like the app forgot itself.

Storage is tiered, mirroring the workspace provider tiers:
`layout.json` in the workspace folder → `localStorage` (`wms-layout-v1`) →
registry default. When a workspace folder is chosen and holds no layout yet, the
`localStorage` copy is migrated into it, so picking a folder never appears to
reset the user's arrangement.

Writes are debounced 500ms and flushed on `pagehide`/`visibilitychange`. A drag
fires layout-change events continuously; without the debounce a single panel
resize would issue dozens of writes to the filesystem.

Any failure to restore falls back to the default layout rather than propagating.
A corrupt layout file must never produce an app that will not open.

## Menu keyboard model

Menus follow the WAI-ARIA menubar pattern with **roving `aria-activedescendant`**
rather than moving real DOM focus per item. Focus stays on the list element; the
highlight is a virtual cursor. This keeps one keydown handler authoritative and
avoids focus thrash on every arrow press. Pinned by
`packages/ui/src/menu/Menu.test.tsx`.

## Viewport is imperative, not react-three-fiber

`RigScene` is a plain class owning its renderer, scene and animation loop. The
60fps loop reads pose data straight from the ring buffer with zero per-frame
allocation; routing that through React reconciliation would add a render pass per
frame to redraw nothing React can see.

Two consequences shaped the shell:

1. The panel component creates the scene in an empty-dependency effect and pushes
   toggle changes imperatively. The `components` map handed to `dockview` is
   memoised on the registry, because a new object identity makes `dockview`
   recreate panels — which for the viewport means destroying a WebGL context.
2. Inactive workspace tabs are hidden with `visibility`, not unmounted. Unmounting
   would lose the GL context on every tab switch. `display: none` is also wrong:
   it gives the canvas a 0×0 layout box, and `dockview` would then restore a
   layout computed at zero size.

The navigation gizmo is drawn as a **scissored second pass in the same GL
context** rather than as a second renderer, for the same reason: WebGL contexts
are a scarce per-page resource and browsers evict the oldest when the limit is hit.

## Document 3 — take storage and stored playback

### Rename is metadata-only, at every tier

`renameProject` and `renameTake` rewrite the `name` field inside `project.json`
and `take.json` and never touch the directory name.

The `fsa` tier could do a real directory rename; `opfs` and `idb-fallback`
effectively cannot. Emulating one on the other means copying every byte of a
take — a multi-hundred-megabyte operation to change a label — and a rename that
behaves differently per tier would be an endless source of path-rewrite bugs.
Ids are slugs assigned at creation and are opaque thereafter; names are display
metadata. Tests pin this: after a rename, `listTakeIds` returns the original id.

### `RefineJobState` is never persisted

A job is a running process, not a property of a take. Restoring a half-finished
job from disk after a reload would be a lie, because the worker driving it is
gone. Reloading mid-refine therefore loses the job and the user re-runs it,
which is safe because the pipeline is idempotent and never mutates `raw`.

### Refined writes are staged, and the manifest is updated last

`writeTakeRefined` writes `refined.bin.tmp`, promotes it to `refined.bin`, and
only then rewrites `take.json` to reference it. A crash at any point leaves a
manifest that still says "no refined data", so the app keeps trusting the raw
track. `cleanupRefineTemp` removes stranded `.tmp` files from cancelled runs.

No provider offers an atomic cross-tier rename, so promotion is copy-then-delete
rather than a true rename. The ordering above is what provides the atomicity
guarantee, not the filesystem.

### Playback stores poses as flat typed arrays

A `PoseTrack` is a struct of `Float32Array`/`Float64Array`, not an array of
per-frame objects. A 60s take at 30fps with 17 joints is ~30k keypoints; as
objects that is tens of thousands of allocations for the GC to walk during
playback. Flat arrays make per-frame access a pointer offset and let a whole
track be transferred to a worker with zero copying.

`useCurrentPose` returns a **stable view mutated in place**, not a fresh object
per frame, for the same reason — at 60fps, allocating per frame is thousands of
garbage objects a second. Consumers read the view immediately and never retain
it. A test asserts buffer identity across reads so this cannot regress.

### One pose-read path, two backends

Every consumer — viewport, 2D overlay, properties — reads poses through
`useCurrentPose`. Behind it sit two unrelated backends: a lock-free ring buffer
for live capture (where "current" means "newest") and array indexing for stored
takes (where "current" means "the frame the transport is parked on"). Keeping
the seam in one file is what lets Document 4 add timeline modes without touching
Viewport internals.

### Scrubbing derives from stored timestamps, never wall-clock or nominal fps

**Achieved precision: exact (0 frames of error) at all 20 test seek positions,
against a spec target of ±1 frame.**

Real capture drops frames and drifts from its nominal rate, so `index / fps` is
wrong — in the test fixture, by more than a full frame by the end of a 10-second
clip. The pose track's recorded per-frame timestamps are the single source of
truth: the video is seeked to a pose frame's timestamp, and after it settles the
frame index is recomputed from the time the decoder actually reached.

Two details are load-bearing:

1. **Seek requests are biased a quarter-frame into the target frame's interval.**
   A decoder displays the frame whose presentation interval contains
   `currentTime`; asking for exactly a frame boundary lets float error tip onto
   the previous frame.
2. **Resolving a video time back to a frame is containment, not nearest-match.**
   This was a real bug caught by the dropped-frame test: a decoder reports the
   exact frame start timestamp, and nearest-match on that tie rounds *down*,
   putting the viewport one frame behind the video at every discontinuity.

The test's fake `<video>` deliberately reproduces decoder quantisation — it
snaps to real frame boundaries and reports where it landed, not what was asked
for. A fake that stored `currentTime` verbatim would pass trivially and prove
nothing.

### `window.confirm` is banned for destructive actions

Native dialogs block the main thread, cannot be tested without stubbing a
global, cannot show the context a delete needs ("this project contains 3
takes"), and are suppressed by some browsers after repeated use — which would
silently turn Delete into a no-op. `Dialog`/`PromptDialog` replace them, with
explicit focus trapping, Escape handling and focus restore, each individually
tested.

## Model acquisition: what is reachable from a sandboxed build agent

Recorded because this was probed exhaustively and should not be re-litigated.

**Reachable**: `registry.npmjs.org`, `pypi.org` + `files.pythonhosted.org`
(86 MB/s), `github.com` HTML and the GitHub API.

**Blocked** (TCP connects, then the TLS handshake is killed — a deliberate
egress policy, not a DNS or routing fault):

| Host | Why it mattered |
|---|---|
| `huggingface.co`, `cdn-lfs*.hf.co` | Every pre-exported ONNX pose model |
| `hf-mirror.com`, `modelscope.cn`, `gitee.com` | HF mirrors |
| `download.openmmlab.com` | RTMPose/RTMDet official ONNX SDK zips |
| `release-assets.githubusercontent.com` | **All** GitHub release-asset binaries |
| `raw.githubusercontent.com`, `media.githubusercontent.com` | Raw repo files |
| `cdn.jsdelivr.net`, `unpkg.com` | npm CDNs |
| `storage.googleapis.com`, `tfhub.dev`, `kaggle.com` | MoveNet's origin |
| `download.pytorch.org` | Torch checkpoints |

GitHub *issues* release redirects (HTTP 302) but the asset CDN they point at is
blocked, so a release URL returning 302 is not evidence the file is obtainable.

**Consequence.** No pre-trained model weights of any kind can be fetched by the
build agent. Packages that *reference* models (`mediapipe`, `ultralytics`,
`rtmlib`) ship code only and download weights at runtime from the blocked hosts.
The one package found bundling real pose weights, `@vladmandic/human`, ships
**TFJS shards, not ONNX** — adopting it would mean a second inference runtime
alongside ONNX Runtime, which is rejected.

**What the agent can still do**, and therefore how this phase is structured:

- `onnx` and `numpy` install fine from PyPI, so a valid `.onnx` file can be
  *authored* locally. That is enough to build and test the plumbing — session
  creation, tensor shapes, I/O binding, the worker protocol — against a
  synthetic model with MoveNet's exact signature.
- All model-dependent geometry is therefore written as pure functions with no
  onnxruntime import (`features/capture/movenet.ts`), so preprocessing and
  decoding are fully covered by tests without any weights present.
- Real weights are supplied out-of-band by a human and dropped into
  `apps/web/public/models/`. The manifest entry stays `acquired:false` with a
  null `sha256` until then, and `fetchModel` refuses to load it — an unverified
  or truncated file must never silently become the thing driving the capture.
