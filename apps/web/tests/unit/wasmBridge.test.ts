import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';

type CoreModule = typeof import('@wms/mocap-core-wasm');

// Resolved from the package root (vitest cwd = apps/web); under the jsdom
// environment `import.meta.url` is not a file: URL, so fileURLToPath can't be used.
const PKG_DIR = resolve(process.cwd(), '../../packages/mocap-core-wasm/pkg');
const PKG_PATH = resolve(PKG_DIR, 'mocap_core.js');

const built = existsSync(PKG_PATH);

/**
 * CI sets WMS_REQUIRE_WASM=1 so a missing build is a hard failure there — this is
 * the Document 1 gate. Locally (e.g. before `pnpm build:wasm`) the suite reports a
 * clear, actionable skip instead of an opaque module-resolution crash.
 */
if (!built) {
  const message =
    'mocap-core WASM package not built. Run `pnpm build:wasm` ' +
    '(needs rustup + wasm-pack; see docs/decisions.md > Toolchain).';
  if (process.env.WMS_REQUIRE_WASM === '1') throw new Error(message);
  console.warn(`[wasmBridge.test] SKIPPED — ${message}`);
}

let init: CoreModule['default'];
let ping: CoreModule['ping'];
let core_version: CoreModule['core_version'];
let OneEuroFilter: CoreModule['OneEuroFilter'];

const WASM_PATH = resolve(PKG_DIR, 'mocap_core_bg.wasm');

/**
 * wasm-pack's `--target web` output defaults to `fetch(new URL(...))`, which Node
 * cannot use for `file://`. Passing the bytes explicitly is the supported way to
 * initialise the same artifact the browser loads — the module under test is
 * byte-identical to the one the app ships.
 */
let initialized = false;
async function initCore() {
  if (!initialized) {
    await init(readFileSync(WASM_PATH));
    initialized = true;
  }
}

beforeAll(async () => {
  if (!built) return;
  const mod = (await import('@wms/mocap-core-wasm')) as CoreModule;
  init = mod.default;
  ping = mod.ping;
  core_version = mod.core_version;
  OneEuroFilter = mod.OneEuroFilter;
  await initCore();
});

/**
 * HARD GATE (Document 1 §5.5): if this fails, the entire compute-core strategy is
 * broken and no other work should proceed.
 *
 * Requires `pnpm build:wasm` first — the import resolves to the wasm-pack output.
 */

function varianceOf(xs: number[]) {
  const m = xs.reduce((a, b) => a + b, 0) / xs.length;
  return xs.reduce((a, b) => a + (b - m) ** 2, 0) / xs.length;
}

describe.skipIf(!built)('mocap-core wasm bridge', () => {
  it('round trips a numeric call through wasm', async () => {
    await initCore();
    expect(ping(21)).toBe(42);
  });

  it('reports the crate version', async () => {
    await initCore();
    expect(core_version()).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it('smooths a noisy signal', async () => {
    await initCore();
    const f = new OneEuroFilter(1.0, 0.007, 1.0);
    const outputs: number[] = [];
    for (let i = 0; i < 50; i++) {
      const noisy = 1.0 + (Math.random() - 0.5) * 0.05;
      outputs.push(f.filter(noisy, i / 30));
    }
    const variance = varianceOf(outputs.slice(-10));
    expect(variance).toBeLessThan(0.01);
  });

  it('converges to a constant input', async () => {
    await initCore();
    const f = new OneEuroFilter(1.0, 0.007, 1.0);
    let out = 0;
    for (let i = 0; i < 200; i++) out = f.filter(5, i / 30);
    expect(out).toBeCloseTo(5, 5);
  });
});
