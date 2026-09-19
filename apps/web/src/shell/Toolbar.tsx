/**
 * Persistent application toolbar (§A.4).
 *
 * Always visible, never inside a panel — the Record button in particular must
 * not be closable or hidden behind a tab (§A.4 note, superseding Document 2 §11
 * which placed transport controls inside the live view).
 *
 * Icons come from `lucide-react`. Hand-rolling SVGs was explicitly rejected: an
 * inconsistent icon set is instantly legible as amateur work.
 */

import {
  Camera,
  Circle,
  Film,
  Pause,
  Play,
  Settings,
  Square,
  WifiOff,
} from 'lucide-react';
import { Badge, IconButton, ThemeToggle, Tooltip, cn } from '@wms/ui';

import type { PanelTypeId } from '../dock/layoutDefaults';
import type { DockController } from '@wms/ui';
import { useEditorStore } from '../state/useEditorStore';
import { formatElapsed, useLiveStore } from '../state/useLiveStore';
import { useAppStore } from '../state/useAppStore';

/**
 * The shared `IconButton` is sized for touch (44px). A 44px control does not fit
 * a 44px toolbar strip, so toolbar instances are shrunk to 28px — still well
 * above the pointer-target floor for a desktop-only chrome element.
 */
const COMPACT = 'h-7 w-7 rounded-lg';

export interface AppToolbarProps {
  dock: DockController<PanelTypeId>;
}

export function AppToolbar({ dock }: AppToolbarProps) {
  const source = useLiveStore((s) => s.source);
  const playing = useLiveStore((s) => s.playing);
  const setPlaying = useLiveStore((s) => s.setPlaying);
  const recording = useLiveStore((s) => s.recording);
  const setRecording = useLiveStore((s) => s.setRecording);
  const setPropertiesContext = useEditorStore((s) => s.setPropertiesContext);
  const offlineReadiness = useAppStore((s) => s.offlineReadiness);

  const hasSource = source.kind !== 'none';
  const isRecording = recording.status === 'recording';

  const toggleRecording = () => {
    if (isRecording) setRecording({ status: 'saving' });
    else setRecording({ status: 'recording', startedAt: performance.now(), elapsedSeconds: 0 });
  };

  return (
    <div
      data-testid="app-toolbar"
      className="flex h-11 shrink-0 items-center gap-2 border-b border-hairline-light bg-surface-light-elevated px-2 dark:border-hairline-dark dark:bg-surface-dark-elevated"
    >
      {/* Source cluster */}
      <div className="flex items-center gap-1">
        <Tooltip content="Use camera">
          <IconButton
            label="Use camera"
            className={COMPACT}
            active={source.kind === 'camera'}
            onClick={() => dock.focus('videoMonitor')}
            icon={<Camera size={16} strokeWidth={1.75} />}
          />
        </Tooltip>
        <Tooltip content="Open video file">
          <IconButton
            label="Open video file"
            className={COMPACT}
            active={source.kind === 'file'}
            onClick={() => dock.focus('videoMonitor')}
            icon={<Film size={16} strokeWidth={1.75} />}
          />
        </Tooltip>
        <span className="ml-1 max-w-[180px] truncate text-[12px] text-content-light-secondary dark:text-content-dark-secondary">
          {hasSource ? source.label : 'No source'}
        </span>
      </div>

      <Divider />

      {/* Transport cluster */}
      <div className="flex items-center gap-1">
        <Tooltip content={playing ? 'Pause' : 'Play'}>
          <IconButton
            label={playing ? 'Pause' : 'Play'}
            className={COMPACT}
            disabled={!hasSource}
            onClick={() => setPlaying(!playing)}
            icon={
              playing ? <Pause size={16} strokeWidth={1.75} /> : <Play size={16} strokeWidth={1.75} />
            }
          />
        </Tooltip>
        <Tooltip content="Stop">
          <IconButton
            label="Stop"
            className={COMPACT}
            disabled={!hasSource}
            onClick={() => setPlaying(false)}
            icon={<Square size={15} strokeWidth={1.75} />}
          />
        </Tooltip>
      </div>

      <Divider />

      {/* Record — deliberately the most prominent control in the app. */}
      <button
        type="button"
        data-testid="record-button"
        disabled={!hasSource || recording.status === 'saving'}
        aria-pressed={isRecording}
        onClick={toggleRecording}
        className={cn(
          'flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-[12px] font-medium',
          'transition-colors duration-150 ease-apple-out',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent',
          'disabled:cursor-not-allowed disabled:opacity-40',
          isRecording
            ? 'bg-danger text-white'
            : 'bg-danger/10 text-danger hover:bg-danger/[0.18]',
        )}
      >
        <Circle
          size={11}
          strokeWidth={0}
          fill="currentColor"
          className={cn(isRecording && 'motion-safe:animate-pulse')}
        />
        {isRecording ? `Recording ${formatElapsed(recording.elapsedSeconds)}` : 'Record'}
      </button>

      <div className="flex-1" />

      {/* Status cluster */}
      {offlineReadiness === 'ready' && (
        <Tooltip content="Everything needed to run offline is cached">
          <span className="flex items-center gap-1 text-[11px] text-content-light-secondary dark:text-content-dark-secondary">
            <WifiOff size={13} strokeWidth={1.75} />
            Offline ready
          </span>
        </Tooltip>
      )}
      {offlineReadiness === 'incomplete' && <Badge tone="warning">Offline incomplete</Badge>}

      <ThemeToggle />

      <Tooltip content="Preferences">
        <IconButton
          label="Preferences"
          className={COMPACT}
          onClick={() => {
            setPropertiesContext({ kind: 'preferences' });
            dock.focus('properties');
          }}
          icon={<Settings size={16} strokeWidth={1.75} />}
        />
      </Tooltip>
    </div>
  );
}

function Divider() {
  return <div aria-hidden="true" className="h-5 w-px bg-hairline-light dark:bg-hairline-dark" />;
}
