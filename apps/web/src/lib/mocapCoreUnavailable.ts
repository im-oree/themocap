/**
 * Stand-in for `@wms/mocap-core-wasm` when the crate has not been built yet.
 *
 * Vite aliases this module in place of the real package only when
 * `packages/mocap-core-wasm/pkg/` is missing (see apps/web/vite.config.ts). It
 * exists so a fresh clone can still run the shell and *see the failure reported in
 * the diagnostics panel*, instead of getting an unresolvable-import build crash.
 *
 * It is NOT a JS fallback for the compute core: every entry point throws. The real
 * numeric path is Rust/WASM only, and CI builds the crate before running tests.
 */
const MESSAGE =
  'mocap-core WASM is not built. Run `pnpm build:wasm` ' +
  '(requires rustup + wasm-pack; see docs/decisions.md > Toolchain).';

export class OneEuroFilter {
  constructor(_min_cutoff: number, _beta: number, _d_cutoff: number) {
    throw new Error(MESSAGE);
  }
  filter(_x: number, _t: number): number {
    throw new Error(MESSAGE);
  }
  reset(): void {
    throw new Error(MESSAGE);
  }
  free(): void {}
}

export function ping(_x: number): number {
  throw new Error(MESSAGE);
}

export function core_version(): string {
  throw new Error(MESSAGE);
}

export default function init(_input?: unknown): Promise<never> {
  return Promise.reject(new Error(MESSAGE));
}
