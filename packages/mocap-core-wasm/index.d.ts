/**
 * Hand-written types mirroring crates/mocap-core's `#[wasm_bindgen]` surface.
 *
 * wasm-pack also emits `pkg/mocap_core.d.ts`, but `pkg/` is generated and
 * git-ignored, so typechecking a fresh clone (or CI before the wasm step) must not
 * depend on it. Keep this file in sync with src/lib.rs — the Rust tests and the
 * Vitest bridge test will catch any drift in behaviour.
 */

/** 1D One Euro filter (Casiez et al., 2012). */
export class OneEuroFilter {
  constructor(min_cutoff: number, beta: number, d_cutoff: number);
  /** Filter sample `x` at timestamp `t` (seconds); returns the smoothed value. */
  filter(x: number, t: number): number;
  /** Drop history so the next sample is treated as the first. */
  reset(): void;
  free(): void;
}

/** Sanity function proving the JS <-> WASM numeric round trip. `ping(21) === 42`. */
export function ping(x: number): number;

/** Version of the Rust crate, surfaced in the diagnostics panel. */
export function core_version(): string;

export interface InitOutput {
  readonly memory: WebAssembly.Memory;
}

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

/** Instantiates the WASM module. Must be awaited before any other export. */
export default function init(module_or_path?: InitInput | Promise<InitInput>): Promise<InitOutput>;
