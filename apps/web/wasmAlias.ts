import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * The Rust compute core is a generated artifact (`pnpm build:wasm`). When it is
 * absent, alias the package to a stub whose every export throws, so the app still
 * bundles and surfaces the problem in diagnostics instead of failing to build.
 *
 * Shared by vite.config.ts and vitest.config.ts so both behave identically.
 */
export const wasmPkgBuilt = existsSync(
  fileURLToPath(new URL('../../packages/mocap-core-wasm/pkg/mocap_core.js', import.meta.url)),
);

export const wasmAlias: Record<string, string> = wasmPkgBuilt
  ? {}
  : {
      '@wms/mocap-core-wasm': fileURLToPath(
        new URL('./src/lib/mocapCoreUnavailable.ts', import.meta.url),
      ),
    };
