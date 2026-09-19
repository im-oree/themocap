import { describe, expect, it } from 'vitest';
import { agreementToMarkdown, resultToMarkdown } from './markdown';
import type { RunResult } from './runner';
import { summarize } from './stats';

const result: RunResult = {
  clipLabel: '640x480',
  backend: 'ort-web-wasm',
  startedAt: '2026-09-19T12:00:00.000Z',
  combinedFps: 27.5,
  combinedPeakHeapBytes: 512 * 1024 * 1024,
  perModel: [
    {
      modelId: 'rtmdet-nano-int8',
      displayName: 'RTMDet-nano (int8)',
      backend: 'ort-web-wasm',
      precision: 'int8',
      loadTimeMs: 210,
      stats: summarize([10, 12, 11, 13]),
      peakHeapBytes: 300 * 1024 * 1024,
    },
    {
      modelId: 'broken',
      displayName: 'Broken model',
      backend: 'ort-web-wasm',
      precision: 'fp16',
      loadTimeMs: 0,
      stats: summarize([]),
      peakHeapBytes: null,
      error: 'HTTP 404',
    },
  ],
};

describe('markdown export', () => {
  const md = resultToMarkdown(result, 'Live path — 640x480');

  it('emits a table matching the docs/benchmarks.md format', () => {
    expect(md).toContain('## Live path — 640x480');
    expect(md).toContain('| Model | Backend | Precision | FPS (avg) |');
    expect(md).toContain('RTMDet-nano (int8)');
    expect(md).toContain('210 ms');
    expect(md).toContain('300 MB');
  });

  it('marks failed runs instead of silently omitting them', () => {
    expect(md).toContain('FAILED');
    expect(md).toContain('HTTP 404');
  });

  it('includes the combined pipeline row', () => {
    expect(md).toContain('**Combined pipeline**');
    expect(md).toContain('27.5');
  });

  it('renders n/a when heap measurement is unavailable', () => {
    const noMem = resultToMarkdown({ ...result, combinedPeakHeapBytes: null });
    expect(noMem).toContain('n/a');
  });

  it('formats the agreement table', () => {
    const md2 = agreementToMarkdown({
      'rtmpose-tiny-fp16': {
        comparedFrames: 30,
        comparedKeypoints: 510,
        meanPixelDistance: 0.0123,
        maxPixelDistance: 0.4567,
      },
    });
    expect(md2).toContain('WASM vs WebGPU numerical agreement');
    expect(md2).toContain('| rtmpose-tiny-fp16 | 30 | 510 | 0.0123 | 0.4567 |');
  });
});
