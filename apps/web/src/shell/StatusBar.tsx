/**
 * Status bar (§A.7).
 *
 * A thin strip reading the master clock. It polls at 10Hz on a timer rather than
 * subscribing to every frame: nobody can read a number that changes 60 times a
 * second, and re-rendering React at frame rate for text nobody can read is the
 * kind of thing that quietly eats the frame budget.
 */

import { useEffect, useState } from 'react';
import { Badge, StatusDot, cn } from '@wms/ui';

import type { PanelTypeId } from '../dock/layoutDefaults';
import type { DockController } from '@wms/ui';
import { getMasterClock, getRateMeter } from '../lib/clock/clockInstance';
import { formatElapsed, useLiveStore } from '../state/useLiveStore';
import { useWorkspaceStore } from '../state/useWorkspaceStore';

const POLL_INTERVAL_MS = 100;

export interface AppStatusBarProps {
  dock: DockController<PanelTypeId>;
}

export function AppStatusBar({ dock }: AppStatusBarProps) {
  const setClockReadout = useLiveStore((s) => s.setClockReadout);
  const recording = useLiveStore((s) => s.recording);
  const source = useLiveStore((s) => s.source);
  const providerId = useWorkspaceStore((s) => s.providerId);
  const workspaceReady = useWorkspaceStore((s) => s.ready);
  const description = useWorkspaceStore((s) => s.description);

  const [readout, setReadout] = useState({ elapsed: 0, frameIndex: 0, fps: 0 });

  useEffect(() => {
    const clock = getMasterClock();
    const meter = getRateMeter();
    const id = window.setInterval(() => {
      const tick = clock.peek();
      const next = { elapsed: tick.t, frameIndex: tick.frameIndex, fps: meter.fps };
      setReadout(next);
      setClockReadout({
        elapsedSeconds: next.elapsed,
        frameIndex: next.frameIndex,
        fps: next.fps,
      });
    }, POLL_INTERVAL_MS);
    return () => window.clearInterval(id);
  }, [setClockReadout]);

  const fpsTone = readout.fps === 0 ? 'neutral' : readout.fps >= 24 ? 'success' : 'warning';

  return (
    <div
      data-testid="status-bar"
      className="flex h-6 shrink-0 items-center gap-3 border-t border-hairline-light bg-surface-light-elevated px-2.5 text-[11px] text-content-light-secondary dark:border-hairline-dark dark:bg-surface-dark-elevated dark:text-content-dark-secondary"
    >
      <span className="flex items-center gap-1.5">
        <StatusDot
          tone={source.kind === 'none' ? 'neutral' : 'success'}
          label={source.kind === 'none' ? 'No source' : source.label}
        />
      </span>

      <Separator />

      <span className="font-mono tabular-nums" data-testid="status-time">
        {formatElapsed(readout.elapsed)}
      </span>
      <span className="font-mono tabular-nums" data-testid="status-frame">
        f{String(Math.max(readout.frameIndex, 0)).padStart(6, '0')}
      </span>
      <span
        className={cn(
          'font-mono tabular-nums',
          fpsTone === 'warning' && 'text-warning',
          fpsTone === 'success' && 'text-success',
        )}
        data-testid="status-fps"
      >
        {readout.fps > 0 ? `${readout.fps.toFixed(1)} fps` : '—'}
      </span>

      <Separator />

      {recording.status === 'recording' && <Badge tone="danger">REC</Badge>}
      {recording.status === 'saving' && <Badge tone="warning">Saving…</Badge>}

      <div className="flex-1" />

      <button
        type="button"
        onClick={() => dock.focus('workspaceBrowser')}
        className="truncate rounded px-1 hover:text-content-light-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent dark:hover:text-content-dark-primary"
        title={description}
      >
        {workspaceReady ? `Storage: ${providerId}` : 'No workspace'}
      </button>

      <Separator />

      {/* Clicking through to Diagnostics replaces Document 1's floating PerfHUD. */}
      <button
        type="button"
        data-testid="status-diagnostics"
        onClick={() => dock.toggle('diagnostics')}
        className="rounded px-1 hover:text-content-light-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent dark:hover:text-content-dark-primary"
      >
        Diagnostics
      </button>
    </div>
  );
}

function Separator() {
  return <span aria-hidden="true" className="h-3 w-px bg-hairline-light dark:bg-hairline-dark" />;
}
