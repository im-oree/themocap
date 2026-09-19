import { readFileSync } from 'node:fs';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { wasmAlias, wasmPkgBuilt } from './wasmAlias';

if (!wasmPkgBuilt) {
  console.warn(
    '[vite] packages/mocap-core-wasm/pkg not found — using the throwing stub. Run `pnpm build:wasm`.',
  );
}

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as {
  version: string;
};

/**
 * COOP/COEP are required for SharedArrayBuffer -> threaded WASM. They are set in
 * dev AND preview; static production hosting must send the same two headers
 * (see docs/decisions.md > Hosting requirements and public/_headers).
 */
const crossOriginIsolationHeaders = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'require-corp',
  'Cross-Origin-Resource-Policy': 'same-origin',
};

export default defineConfig({
  plugins: [react()],
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  server: {
    host: true,
    port: 5173,
    headers: crossOriginIsolationHeaders,
    // Allow sandbox/preview hostnames (e.g. *.e2b.app) in addition to localhost.
    allowedHosts: true,
  },
  preview: {
    host: true,
    port: 4173,
    headers: crossOriginIsolationHeaders,
    allowedHosts: true,
  },
  worker: {
    format: 'es',
  },
  build: {
    target: 'es2022',
    sourcemap: true,
  },
  resolve: { alias: wasmAlias },
  optimizeDeps: {
    // The wasm-pack output is a generated local package; let Vite serve it as-is.
    exclude: ['@wms/mocap-core-wasm', 'onnxruntime-web'],
  },
});
