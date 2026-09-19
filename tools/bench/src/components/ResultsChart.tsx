import type { RunResult } from '../lib/runner';

/** Plain SVG bar chart — no charting library needed for an internal tool. */
export function ResultsChart({ result }: { result: RunResult }) {
  const bars = result.perModel
    .filter((m) => !m.error && m.stats.frames > 0)
    .map((m) => ({ label: m.displayName, value: m.stats.avgFps }));

  if (result.combinedFps !== null) {
    bars.push({ label: 'Combined', value: result.combinedFps });
  }

  if (bars.length === 0) {
    return (
      <p className="text-sm text-content-light-secondary dark:text-content-dark-secondary">
        No successful runs to chart.
      </p>
    );
  }

  const max = Math.max(...bars.map((b) => b.value), 24);
  const rowHeight = 34;
  const labelWidth = 190;
  const chartWidth = 420;
  const height = bars.length * rowHeight + 24;
  // Reference lines for the Phase 0 acceptance bars.
  const targets = [
    { value: 24, label: '24 fps (live bar)' },
    { value: 3, label: '3 fps (refine bar)' },
  ].filter((t) => t.value <= max);

  return (
    <svg
      viewBox={`0 0 ${labelWidth + chartWidth + 60} ${height}`}
      className="w-full"
      role="img"
      aria-label="Average FPS per model"
    >
      {targets.map((t) => {
        const x = labelWidth + (t.value / max) * chartWidth;
        return (
          <g key={t.label}>
            <line
              x1={x}
              y1={4}
              x2={x}
              y2={bars.length * rowHeight + 4}
              stroke="currentColor"
              strokeDasharray="3 3"
              className="text-accent/50"
            />
            <text x={x + 4} y={height - 6} className="fill-current text-[9px] opacity-60">
              {t.label}
            </text>
          </g>
        );
      })}
      {bars.map((bar, i) => {
        const y = i * rowHeight + 8;
        const w = Math.max(2, (bar.value / max) * chartWidth);
        return (
          <g key={bar.label}>
            <text x={0} y={y + 14} className="fill-current text-[11px]">
              {bar.label.length > 26 ? `${bar.label.slice(0, 25)}…` : bar.label}
            </text>
            <rect
              x={labelWidth}
              y={y}
              width={w}
              height={20}
              rx={5}
              className={bar.label === 'Combined' ? 'fill-accent' : 'fill-accent/60'}
            />
            <text x={labelWidth + w + 6} y={y + 14} className="fill-current text-[11px] opacity-70">
              {bar.value.toFixed(1)}
            </text>
          </g>
        );
      })}
    </svg>
  );
}
