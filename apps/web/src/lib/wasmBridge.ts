import init, { ping, core_version, OneEuroFilter } from '@wms/mocap-core-wasm';

/**
 * Single initialization point for the Rust compute core. There is deliberately no
 * JS fallback — if this fails, the app is broken and must say so loudly.
 */

let initPromise: Promise<void> | undefined;

export function initMocapCore(): Promise<void> {
  initPromise ??= init().then(() => undefined);
  return initPromise;
}

export interface WasmProbeResult {
  ok: boolean;
  /** ping(21) — must be 42. */
  pingResult: number | null;
  coreVersion: string | null;
  /** Variance of the last samples of a filtered noisy constant. */
  filterVariance: number | null;
  error: string | null;
  elapsedMs: number;
}

/** Live smoke test shown in the diagnostics panel on every app load. */
export async function probeMocapCore(): Promise<WasmProbeResult> {
  const started = performance.now();
  try {
    await initMocapCore();
    const pingResult = ping(21);

    const filter = new OneEuroFilter(1.0, 0.007, 1.0);
    const outputs: number[] = [];
    for (let i = 0; i < 50; i++) {
      const noisy = 1.0 + (Math.sin(i * 12.9898) * 0.5 - 0.25) * 0.05;
      outputs.push(filter.filter(noisy, i / 30));
    }
    const tail = outputs.slice(-10);
    const mean = tail.reduce((a, b) => a + b, 0) / tail.length;
    const filterVariance = tail.reduce((a, b) => a + (b - mean) ** 2, 0) / tail.length;

    return {
      ok: pingResult === 42 && filterVariance < 0.01,
      pingResult,
      coreVersion: core_version(),
      filterVariance,
      error: null,
      elapsedMs: performance.now() - started,
    };
  } catch (error) {
    return {
      ok: false,
      pingResult: null,
      coreVersion: null,
      filterVariance: null,
      error: error instanceof Error ? error.message : String(error),
      elapsedMs: performance.now() - started,
    };
  }
}
