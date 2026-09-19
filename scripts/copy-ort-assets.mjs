#!/usr/bin/env node
/**
 * Copies the onnxruntime-web WASM binaries out of node_modules into each app's
 * public/ort/ directory.
 *
 * This exists because ORT defaults to loading its .wasm/.mjs files from a
 * jsDelivr CDN. That would violate the project's offline rule, so we serve them
 * same-origin and point `ort.env.wasm.wasmPaths` at '/ort/'.
 *
 * Runs automatically via the root `postinstall` hook.
 */
import { copyFileSync, existsSync, mkdirSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const targets = [
  join(root, 'apps', 'web', 'public', 'ort'),
  join(root, 'tools', 'bench', 'public', 'ort'),
];

const require = createRequire(join(root, 'packages', 'inference', 'package.json'));

// Resolve via the package entry point: onnxruntime-web's `exports` map does not
// expose package.json, so require.resolve('onnxruntime-web/package.json') fails.
let distDir;
try {
  distDir = dirname(require.resolve('onnxruntime-web'));
} catch {
  console.warn('[copy-ort-assets] onnxruntime-web not installed yet; skipping.');
  process.exit(0);
}

if (!existsSync(distDir)) {
  console.warn(`[copy-ort-assets] ${distDir} not found; skipping.`);
  process.exit(0);
}

const wanted = readdirSync(distDir).filter((f) => /\.(wasm|mjs)$/.test(f) && f.startsWith('ort-'));

if (wanted.length === 0) {
  console.warn('[copy-ort-assets] no ORT wasm assets found; skipping.');
  process.exit(0);
}

for (const target of targets) {
  mkdirSync(target, { recursive: true });
  for (const file of wanted) copyFileSync(join(distDir, file), join(target, file));
  console.log(`[copy-ort-assets] copied ${wanted.length} files -> ${target}`);
}
