# Web Mocap Studio

Browser-native markerless motion capture. Runs entirely locally — no CDN, no remote
fonts, no remote models, no telemetry.

**Current state: Document 1 (foundation) — see [`docs/decisions.md`](docs/decisions.md).**
There is no mocap functionality yet. This phase delivers the monorepo, the design
system, the Rust→WASM compute bridge, and the benchmark harness that decides which
models the rest of the project uses.

> ⚠️ Document 1 is **not fully closed**: the benchmark numbers and the resulting
> model decisions are still outstanding. See
> [Open blocker](docs/decisions.md#️-open-blocker-no-benchmark-numbers-yet).

## Quick start

> **Use pnpm, not npm.** This is a pnpm workspace (`pnpm-workspace.yaml`). npm
> and yarn do not read that file, so `npm install` installs only the root
> dependencies, leaves `apps/*` and `packages/*` empty, and then fails with
> `sh: vite: command not found`. A `preinstall` hook blocks this, but if you hit
> it already: `rm -rf node_modules package-lock.json && pnpm install`.

```bash
corepack enable && corepack prepare pnpm@9.15.4 --activate
curl https://sh.rustup.rs -sSf | sh -s -- -y
rustup target add wasm32-unknown-unknown
cargo install wasm-pack --locked

pnpm install
pnpm build:wasm        # required: the compute core has no JS fallback
pnpm dev               # app   -> http://localhost:5173
pnpm dev:bench         # bench -> http://localhost:5174
```

## Layout

```
apps/web            The application shell (the real one, not a mockup)
crates/mocap-core   Rust compute core -> WASM (filters, math)
packages/ui         Design system: tokens, primitives, theme, PerfHUD
packages/inference  Backend-agnostic inference contracts + ORT Web implementation
packages/models     Model manifest, checksums, download manager
packages/skeleton   Skeleton topologies (COCO-17, H36M-17, target rig)
tools/bench         Benchmark harness — picks the models for Documents 2+
docs/               decisions.md, benchmarks.md, licenses.md, electron-plan.md
```

## Scripts

| Command                                        | What it does                                    |
| ---------------------------------------------- | ----------------------------------------------- |
| `pnpm dev` / `pnpm dev:bench`                  | Dev servers (COOP/COEP headers on)              |
| `pnpm build`                                   | Build every package                             |
| `pnpm build:wasm`                              | `wasm-pack` build of `crates/mocap-core`        |
| `pnpm test`                                    | Vitest across the workspace                     |
| `pnpm test:rust`                               | `cargo test --workspace`                        |
| `pnpm e2e`                                     | Playwright smoke suite                          |
| `pnpm lint` / `pnpm typecheck` / `pnpm format` | Code quality                                    |
| `pnpm check:no-remote`                         | Fails if shipped code references any remote URL |

## CI

The workflow is at [`ci/ci.yml`](ci/ci.yml), not `.github/workflows/`, because the
automation that created this branch lacks GitHub's `workflows` permission. Enable
it with:

```bash
mkdir -p .github/workflows && git mv ci/ci.yml .github/workflows/ci.yml
```

See [`ci/README.md`](ci/README.md) for what it runs.

## Non-negotiables

These are enforced by tests and CI, not convention:

- **Fully offline.** No CDN, remote font, or remote model URL. Enforced by
  `scripts/check-no-remote.mjs`, the runtime `networkGuard`, and a Playwright test.
- **Compute is Rust/WASM.** No JavaScript fallback for compute kernels. The one
  documented exemption is bench-only preprocessing.
- **Cross-origin isolated.** COOP/COEP in dev, preview, and production hosting;
  `crossOriginIsolated === true` is asserted by Playwright against both servers.
- **Permissive licensing only.** Nothing non-commercial, nothing SMPL-encumbered.
  See [`docs/licenses.md`](docs/licenses.md).
