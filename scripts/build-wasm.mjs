#!/usr/bin/env node
/**
 * Builds crates/mocap-core to WASM and lands the wasm-bindgen output in
 * packages/mocap-core-wasm/pkg, which is re-exported as @wms/mocap-core-wasm.
 *
 * Requires: rustup stable + wasm32-unknown-unknown target + wasm-pack 0.13+.
 */
import { execFileSync, execSync } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(root, 'packages', 'mocap-core-wasm', 'pkg');

function has(cmd) {
  try {
    execSync(`command -v ${cmd}`, { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

if (!has('wasm-pack')) {
  console.error(
    [
      'wasm-pack not found.',
      '',
      'Install the toolchain (see docs/decisions.md > Toolchain):',
      '  curl https://sh.rustup.rs -sSf | sh -s -- -y',
      '  rustup target add wasm32-unknown-unknown',
      '  cargo install wasm-pack --locked',
    ].join('\n'),
  );
  process.exit(1);
}

mkdirSync(outDir, { recursive: true });

const args = [
  'build',
  join('crates', 'mocap-core'),
  '--target',
  'web',
  '--out-dir',
  join('..', '..', 'packages', 'mocap-core-wasm', 'pkg'),
  '--out-name',
  'mocap_core',
  process.env.WASM_PROFILE === 'dev' ? '--dev' : '--release',
];

console.log(`> wasm-pack ${args.join(' ')}`);
execFileSync('wasm-pack', args, { cwd: root, stdio: 'inherit' });

if (!existsSync(join(outDir, 'mocap_core_bg.wasm'))) {
  console.error('wasm-pack finished but mocap_core_bg.wasm is missing.');
  process.exit(1);
}
console.log('WASM build OK ->', outDir);
