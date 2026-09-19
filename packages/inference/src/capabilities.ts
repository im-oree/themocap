/// <reference types="@webgpu/types" />
import type { Capabilities } from './types';

/**
 * Canonical SIMD feature probe (same module `wasm-feature-detect` uses):
 *
 *   (module (func (i32.const 0) (i8x16.splat) (drop)))
 *
 * `i8x16.splat` is opcode 0xfd 0x0f, so validation fails on engines without the
 * SIMD proposal. Validating (not instantiating) keeps the check synchronous.
 */
const SIMD_PROBE = new Uint8Array([
  0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00, 0x01, 0x04, 0x01, 0x60, 0x00, 0x00, 0x03, 0x02,
  0x01, 0x00, 0x0a, 0x09, 0x01, 0x07, 0x00, 0x41, 0x00, 0xfd, 0x0f, 0x1a, 0x0b,
]);

export function detectSimd(): boolean {
  try {
    return WebAssembly.validate(SIMD_PROBE);
  } catch {
    return false;
  }
}

export function detectCrossOriginIsolated(): boolean {
  return typeof globalThis.crossOriginIsolated === 'boolean'
    ? globalThis.crossOriginIsolated
    : false;
}

/** Threads need SharedArrayBuffer, which needs cross-origin isolation. */
export function detectThreads(): boolean {
  const hasSab = typeof SharedArrayBuffer !== 'undefined';
  const cores = typeof navigator !== 'undefined' ? (navigator.hardwareConcurrency ?? 1) : 1;
  return hasSab && detectCrossOriginIsolated() && cores > 1;
}

export async function detectWebGPU(): Promise<boolean> {
  if (typeof navigator === 'undefined' || !('gpu' in navigator)) return false;
  try {
    const gpu = (navigator as Navigator & { gpu?: GPU }).gpu;
    const adapter = await gpu?.requestAdapter();
    return Boolean(adapter);
  } catch {
    return false;
  }
}

interface NavigatorWithMemory extends Navigator {
  deviceMemory?: number;
}

/** Conservative heuristic; ORT will fail loudly long before this matters. */
export function estimateMaxBufferBytes(deviceMemoryGb: number | null): number {
  const gb = deviceMemoryGb ?? 4;
  // Never promise more than ~25% of reported RAM for a single buffer, cap at 1 GiB.
  return Math.min(Math.floor(gb * 0.25 * 1024 ** 3), 1024 ** 3);
}

export async function detectCapabilities(): Promise<Capabilities> {
  const nav = typeof navigator !== 'undefined' ? (navigator as NavigatorWithMemory) : undefined;
  const deviceMemoryGb = nav?.deviceMemory ?? null;
  return {
    simd: detectSimd(),
    threads: detectThreads(),
    crossOriginIsolated: detectCrossOriginIsolated(),
    webgpu: await detectWebGPU(),
    hardwareConcurrency: nav?.hardwareConcurrency ?? 1,
    maxBufferBytes: estimateMaxBufferBytes(deviceMemoryGb),
    deviceMemoryGb,
  };
}

/** Thread count ORT should use: leave a core for the UI, cap at 4 (M1 efficiency). */
export function recommendedThreadCount(caps: Capabilities): number {
  if (!caps.threads) return 1;
  return Math.max(1, Math.min(4, caps.hardwareConcurrency - 1));
}
