import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

/** Same cross-origin isolation requirements as the app: bench numbers must be
 *  measured under the exact conditions production runs in. */
const headers = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'require-corp',
  'Cross-Origin-Resource-Policy': 'same-origin',
};

export default defineConfig({
  plugins: [react()],
  server: { host: true, port: 5174, headers, allowedHosts: true },
  preview: { host: true, port: 4174, headers, allowedHosts: true },
  worker: { format: 'es' },
  optimizeDeps: { exclude: ['onnxruntime-web'] },
  build: { target: 'es2022' },
});
