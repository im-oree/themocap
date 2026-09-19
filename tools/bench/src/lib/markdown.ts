import type { AgreementStats } from './stats';
import type { RunResult } from './runner';

/** Formats results exactly as docs/benchmarks.md expects, so nothing is retyped. */

function mb(bytes: number | null): string {
  return bytes === null ? 'n/a' : `${(bytes / 1024 / 1024).toFixed(0)} MB`;
}

function num(value: number, digits = 1): string {
  return Number.isFinite(value) ? value.toFixed(digits) : '—';
}

export function resultToMarkdown(result: RunResult, heading?: string): string {
  const lines: string[] = [];
  if (heading) lines.push(`## ${heading}`, '');
  lines.push(
    `_Clip ${result.clipLabel} · backend \`${result.backend}\` · ${new Date(result.startedAt).toISOString().slice(0, 10)}_`,
    '',
    '| Model | Backend | Precision | FPS (avg) | p10 ms | p50 ms | p90 ms | Load time | Peak mem |',
    '|---|---|---|---|---|---|---|---|---|',
  );

  for (const m of result.perModel) {
    if (m.error) {
      lines.push(
        `| ${m.displayName} | ${m.backend} | ${m.precision} | FAILED | — | — | — | — | — |`,
        `| ↳ error | | | \`${m.error.replace(/\|/g, '\\|')}\` | | | | | |`,
      );
      continue;
    }
    lines.push(
      `| ${m.displayName} | ${m.backend} | ${m.precision} | ${num(m.stats.avgFps)} | ` +
        `${num(m.stats.p10FrameMs)} | ${num(m.stats.p50FrameMs)} | ${num(m.stats.p90FrameMs)} | ` +
        `${num(m.loadTimeMs, 0)} ms | ${mb(m.peakHeapBytes)} |`,
    );
  }

  lines.push(
    `| **Combined pipeline** | ${result.backend} | — | ${result.combinedFps === null ? '—' : num(result.combinedFps)} | — | — | — | — | ${mb(result.combinedPeakHeapBytes)} |`,
    '',
  );
  return lines.join('\n');
}

export function agreementToMarkdown(agreement: Record<string, AgreementStats>): string {
  const lines = [
    '### WASM vs WebGPU numerical agreement',
    '',
    '| Model | Frames compared | Keypoints | Mean distance | Max distance |',
    '|---|---|---|---|---|',
  ];
  for (const [id, a] of Object.entries(agreement)) {
    lines.push(
      `| ${id} | ${a.comparedFrames} | ${a.comparedKeypoints} | ${a.meanPixelDistance.toFixed(4)} | ${a.maxPixelDistance.toFixed(4)} |`,
    );
  }
  lines.push('');
  return lines.join('\n');
}

export function environmentBlock(): string {
  const ua = typeof navigator !== 'undefined' ? navigator.userAgent : 'unknown';
  const cores = typeof navigator !== 'undefined' ? navigator.hardwareConcurrency : 0;
  return [
    '<!-- environment -->',
    `- Date: ${new Date().toISOString()}`,
    `- User agent: ${ua}`,
    `- Logical cores: ${cores}`,
    `- crossOriginIsolated: ${typeof crossOriginIsolated !== 'undefined' ? crossOriginIsolated : 'unknown'}`,
    '',
  ].join('\n');
}
