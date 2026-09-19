/**
 * Diagnostics panel (§B.6).
 *
 * One consistent home for every under-the-hood number, replacing Document 1's
 * embedded diagnostics block and the floating PerfHUD. Closed by default and
 * reopened from the Panels menu or by clicking the status bar's capability
 * segment.
 *
 * Ring-buffer health and the dropped-frame counter (Document 2 §6.3) belong here
 * as they come online, rather than accumulating as per-phase overlays.
 */

import { Diagnostics } from '../app/Diagnostics';
import { useLiveStore } from '../state/useLiveStore';

export function DiagnosticsPanel() {
  const frameIndex = useLiveStore((s) => s.frameIndex);
  const fps = useLiveStore((s) => s.fps);

  return (
    <div className="h-full w-full overflow-auto bg-surface-light-elevated p-3 dark:bg-surface-dark-elevated">
      <section className="mb-4">
        <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-content-light-secondary dark:text-content-dark-secondary">
          Pipeline
        </h3>
        <dl className="flex flex-col gap-1 text-[12px]">
          <Row label="Frames issued" value={String(frameIndex)} />
          <Row label="Capture rate" value={fps > 0 ? `${fps.toFixed(1)} fps` : '—'} />
          <Row label="Frames dropped" value="— (wired with the capture worker)" />
          <Row label="Ring buffers" value="— (wired with the capture worker)" />
        </dl>
      </section>

      <section>
        <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-content-light-secondary dark:text-content-dark-secondary">
          Capabilities
        </h3>
        <Diagnostics />
      </section>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-content-light-secondary dark:text-content-dark-secondary">{label}</dt>
      <dd className="truncate font-mono text-content-light-primary dark:text-content-dark-primary">
        {value}
      </dd>
    </div>
  );
}
