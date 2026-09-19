/**
 * Timeline panel (§B.3) — shell and scrub behaviour only.
 *
 * Present from day one because an editor without a timeline dock is not an
 * editor, even though the multi-track content is Document 4's work. What exists
 * now:
 *
 * - a playhead bound to the master clock,
 * - a scrub bar that seeks in file-playback mode,
 * - a recording-elapsed fill in live-camera mode, where scrubbing is meaningless,
 * - an explicitly empty `TrackArea` slot, so Document 4 adds tracks without
 *   restructuring anything.
 *
 * ## Seek precision
 *
 * Seeking is implemented against `HTMLVideoElement.currentTime` here. That is
 * accurate to the nearest *decoded* frame and, for a typical WebM/MP4 with a
 * 1–2s keyframe interval, the browser handles the keyframe-then-step-forward
 * work internally. Document 3's frame-accurate scrubbing requirement may need
 * the explicit `VideoDecoder` flush/reseek path instead; that decision is
 * deferred until there is a take to scrub, but the seek call is funnelled
 * through `seekTo` below so there is exactly one place to change.
 */

import { useCallback, useRef } from 'react';
import { cn } from '@wms/ui';

import { formatElapsed, useLiveStore } from '../state/useLiveStore';

export function TimelinePanel() {
  const source = useLiveStore((s) => s.source);
  const elapsed = useLiveStore((s) => s.elapsedSeconds);
  const frameIndex = useLiveStore((s) => s.frameIndex);
  const recording = useLiveStore((s) => s.recording);
  const trackRef = useRef<HTMLDivElement>(null);

  const isFile = source.kind === 'file';
  const isLive = source.kind === 'camera';
  // No duration is known for a live camera; file duration arrives with the take.
  const duration = isFile ? Math.max(elapsed, 1) : 0;
  const progress = isFile && duration > 0 ? Math.min(1, elapsed / duration) : 0;

  const seekTo = useCallback((seconds: number) => {
    // Single funnel point for every seek — see the note above about the
    // WebCodecs path Document 3 may need.
    const video = document.querySelector<HTMLVideoElement>('[data-testid="source-video"]');
    if (video) video.currentTime = seconds;
  }, []);

  const onScrub = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (!isFile) return;
      const rect = trackRef.current?.getBoundingClientRect();
      if (!rect || rect.width === 0) return;
      const ratio = Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width));
      seekTo(ratio * duration);
    },
    [isFile, duration, seekTo],
  );

  const recordingFill =
    recording.status === 'recording'
      ? Math.min(1, (recording.elapsedSeconds % 60) / 60)
      : 0;

  return (
    <div className="flex h-full w-full flex-col bg-surface-light-elevated dark:bg-surface-dark-elevated">
      <div className="flex items-center gap-3 border-b border-hairline-light px-3 py-2 dark:border-hairline-dark">
        <span className="font-mono text-[11px] tabular-nums text-content-light-secondary dark:text-content-dark-secondary">
          {formatElapsed(elapsed)}
        </span>
        <span className="font-mono text-[11px] tabular-nums text-content-light-secondary dark:text-content-dark-secondary">
          f{String(frameIndex).padStart(6, '0')}
        </span>

        <div
          ref={trackRef}
          role={isFile ? 'slider' : undefined}
          aria-label={isFile ? 'Scrub position' : undefined}
          aria-valuemin={isFile ? 0 : undefined}
          aria-valuemax={isFile ? duration : undefined}
          aria-valuenow={isFile ? elapsed : undefined}
          aria-disabled={!isFile}
          tabIndex={isFile ? 0 : -1}
          onPointerDown={onScrub}
          onPointerMove={(event) => event.buttons === 1 && onScrub(event)}
          data-testid="timeline-scrub"
          className={cn(
            'relative h-2 flex-1 overflow-hidden rounded-full',
            'bg-black/[0.08] dark:bg-white/[0.12]',
            isFile ? 'cursor-pointer' : 'cursor-default opacity-60',
          )}
        >
          {isFile && (
            <div
              className="absolute inset-y-0 left-0 bg-accent"
              style={{ width: `${progress * 100}%` }}
            />
          )}
          {isLive && recording.status === 'recording' && (
            <div
              className="absolute inset-y-0 left-0 bg-danger transition-[width] duration-220 ease-apple-out"
              style={{ width: `${recordingFill * 100}%` }}
              data-testid="recording-progress"
            />
          )}
          {isFile && (
            <div
              className="absolute top-1/2 h-3 w-[3px] -translate-y-1/2 rounded-full bg-accent"
              style={{ left: `calc(${progress * 100}% - 1.5px)` }}
              data-testid="timeline-playhead"
            />
          )}
        </div>

        <span className="text-[11px] text-content-light-secondary dark:text-content-dark-secondary">
          {isFile ? 'File' : isLive ? 'Live' : 'No source'}
        </span>
      </div>

      <TrackArea />
    </div>
  );
}

/**
 * Reserved slot for Document 4's tracks, confidence heatmap and jitter graph.
 * Rendered as an explicit placeholder rather than left blank so the panel reads
 * as "not yet" rather than "broken".
 */
function TrackArea() {
  return (
    <div
      data-testid="timeline-track-area"
      className="flex flex-1 items-center justify-center px-3 py-2"
    >
      <p className="text-[11px] text-content-light-secondary dark:text-content-dark-secondary">
        Tracks, confidence heatmap and jitter graph arrive in Document 4.
      </p>
    </div>
  );
}
