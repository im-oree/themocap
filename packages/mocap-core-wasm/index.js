/**
 * Re-export of the wasm-pack output for crates/mocap-core.
 *
 * `pkg/` is generated (git-ignored). Run `pnpm build:wasm` before importing this
 * package. There is deliberately no JS fallback: the compute core is Rust/WASM only.
 */
export * from './pkg/mocap_core.js';
export { default } from './pkg/mocap_core.js';
