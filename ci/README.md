# CI workflow

`ci.yml` is the GitHub Actions workflow for this project. It lives here rather than
in `.github/workflows/` **only** because the automation that created this branch
lacks the GitHub `workflows` permission and cannot push files under
`.github/workflows/`.

Activate it with one command:

```bash
mkdir -p .github/workflows && git mv ci/ci.yml .github/workflows/ci.yml
git commit -m "Enable CI workflow"
```

## What it runs

Three jobs, on every push and pull request:

1. **rust** — `cargo fmt --check`, `cargo clippy -D warnings`, `cargo test --workspace`,
   then `wasm-pack` build of `crates/mocap-core`, uploaded as an artifact.
2. **node** — `pnpm lint`, `format:check`, `typecheck`, `pnpm -r test` with
   `WMS_REQUIRE_WASM=1` (so the WASM bridge test is a hard gate, not a skip),
   `pnpm build`, and `pnpm check:no-remote`.
3. **e2e** — Playwright smoke suite against the dev server **and** the preview
   build, which is how `crossOriginIsolated === true` is verified on both.

The node and e2e jobs download the wasm artifact from the rust job, so the real
compiled core is what gets tested.
