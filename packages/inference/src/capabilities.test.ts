import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  detectCrossOriginIsolated,
  detectSimd,
  detectThreads,
  detectWebGPU,
  estimateMaxBufferBytes,
  recommendedThreadCount,
} from './capabilities';
import type { Capabilities } from './types';

const baseCaps: Capabilities = {
  simd: true,
  threads: true,
  crossOriginIsolated: true,
  webgpu: false,
  hardwareConcurrency: 8,
  maxBufferBytes: 1024,
  deviceMemoryGb: 8,
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('capability detection', () => {
  it('validates the SIMD probe module on a SIMD-capable engine', () => {
    // Node 20 ships SIMD; this also guards the probe bytes from corruption.
    expect(detectSimd()).toBe(true);
  });

  it('reports crossOriginIsolated from the global', () => {
    vi.stubGlobal('crossOriginIsolated', true);
    expect(detectCrossOriginIsolated()).toBe(true);
    vi.stubGlobal('crossOriginIsolated', false);
    expect(detectCrossOriginIsolated()).toBe(false);
  });

  it('requires SAB, isolation and >1 core for threads', () => {
    vi.stubGlobal('crossOriginIsolated', false);
    vi.stubGlobal('navigator', { hardwareConcurrency: 8 });
    expect(detectThreads()).toBe(false);

    vi.stubGlobal('crossOriginIsolated', true);
    vi.stubGlobal('navigator', { hardwareConcurrency: 1 });
    expect(detectThreads()).toBe(false);

    vi.stubGlobal('crossOriginIsolated', true);
    vi.stubGlobal('navigator', { hardwareConcurrency: 8 });
    expect(detectThreads()).toBe(true);
  });

  it('detects WebGPU only when an adapter is granted', async () => {
    vi.stubGlobal('navigator', {});
    await expect(detectWebGPU()).resolves.toBe(false);

    vi.stubGlobal('navigator', { gpu: { requestAdapter: async () => null } });
    await expect(detectWebGPU()).resolves.toBe(false);

    vi.stubGlobal('navigator', { gpu: { requestAdapter: async () => ({}) } });
    await expect(detectWebGPU()).resolves.toBe(true);

    vi.stubGlobal('navigator', {
      gpu: {
        requestAdapter: async () => {
          throw new Error('boom');
        },
      },
    });
    await expect(detectWebGPU()).resolves.toBe(false);
  });

  it('caps the max buffer heuristic at 1 GiB and defaults without deviceMemory', () => {
    // 8 GB * 25% = 2 GiB, which exceeds the 1 GiB cap.
    expect(estimateMaxBufferBytes(8)).toBe(1024 ** 3);
    expect(estimateMaxBufferBytes(2)).toBe(Math.floor(0.5 * 1024 ** 3));
    // No deviceMemory => assume 4 GB => 1 GiB.
    expect(estimateMaxBufferBytes(null)).toBe(1024 ** 3);
  });

  it('leaves a core free for the UI and caps at 4 threads', () => {
    expect(recommendedThreadCount({ ...baseCaps, hardwareConcurrency: 8 })).toBe(4);
    expect(recommendedThreadCount({ ...baseCaps, hardwareConcurrency: 4 })).toBe(3);
    expect(recommendedThreadCount({ ...baseCaps, hardwareConcurrency: 2 })).toBe(1);
    expect(recommendedThreadCount({ ...baseCaps, threads: false })).toBe(1);
  });
});
