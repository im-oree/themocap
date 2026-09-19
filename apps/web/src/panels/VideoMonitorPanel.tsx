/**
 * Video Monitor panel (§B.2): the source frame plus the 2D keypoint overlay.
 *
 * Content is unchanged from Document 2 §9 — what changed is the hosting. It is
 * no longer a hardcoded left half of the screen but a dock panel the user can
 * put anywhere, so every empty state is rendered *inside* the panel rather than
 * as a full-page takeover.
 *
 * The overlay canvas is a sibling of the video, sized to the video's displayed
 * box rather than its intrinsic resolution, so keypoints stay registered when
 * the panel is resized to an aspect ratio the source does not match.
 */

import { useEffect, useRef, useState } from 'react';
import { cn } from '@wms/ui';

import { useLiveStore } from '../state/useLiveStore';
import { subscribeToSource } from '../features/capture/sourceController';
import type { AcquiredSource } from '../features/capture/mediaSource';

export function VideoMonitorPanel() {
  const hostRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const [box, setBox] = useState({ width: 0, height: 0 });

  const source = useLiveStore((s) => s.source);
  const frameIndex = useLiveStore((s) => s.frameIndex);
  const permission = useLiveStore((s) => s.cameraPermission);
  const playing = useLiveStore((s) => s.playing);

  /**
   * Attaches the acquired source to the element.
   *
   * The stream is taken from the source controller rather than the store: a
   * MediaStream in a React store outlives the hardware it points at, and a
   * stale one renders a black frame with no error. Subscribing here means the
   * element always reflects the *currently owned* source.
   */
  useEffect(() => {
    return subscribeToSource((acquired: AcquiredSource | null) => {
      const video = videoRef.current;
      if (!video) return;

      if (!acquired) {
        video.srcObject = null;
        video.removeAttribute('src');
        video.load();
        return;
      }

      if (acquired.stream) {
        video.srcObject = acquired.stream;
        video.removeAttribute('src');
      } else if (acquired.objectUrl) {
        video.srcObject = null;
        video.src = acquired.objectUrl;
      }

      // A camera preview is live and should start immediately; a file waits for
      // the transport so opening one does not surprise the user with playback.
      if (acquired.kind === 'camera') {
        void video.play().catch(() => undefined);
      }
    });
    // The <video> is remounted whenever hasSource flips, so re-attach then.
  }, [source.kind]);

  /**
   * Transport control, for **file sources only**.
   *
   * A live camera preview must never be paused by the transport. Applying it to
   * cameras was a real bug: `playing` starts false, so this effect ran straight
   * after the stream was attached and froze the preview on a black frame, which
   * looked exactly like a camera that had failed to open. For a live stream
   * there is nothing to pause — the frames keep arriving regardless — so Play
   * and Stop only mean something for a file.
   */
  useEffect(() => {
    const video = videoRef.current;
    if (!video || source.kind !== 'file') return;
    if (playing) void video.play().catch(() => undefined);
    else video.pause();
  }, [playing, source.kind]);

  // Keep the overlay exactly on top of the letterboxed video rect.
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const observer = new ResizeObserver((entries) => {
      const rect = entries[0]?.contentRect;
      if (rect) setBox({ width: rect.width, height: rect.height });
    });
    observer.observe(host);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const canvas = overlayRef.current;
    if (!canvas || box.width === 0) return;
    const dpr = Math.min(window.devicePixelRatio ?? 1, 2);
    canvas.width = Math.round(box.width * dpr);
    canvas.height = Math.round(box.height * dpr);
  }, [box]);

  const hasSource = source.kind !== 'none';

  return (
    <div
      ref={hostRef}
      data-testid="video-monitor-panel"
      className="relative h-full w-full overflow-hidden bg-black"
    >
      {hasSource ? (
        <>
          <video
            ref={videoRef}
            playsInline
            muted
            className="absolute inset-0 h-full w-full object-contain"
            data-testid="source-video"
          />
          <canvas
            ref={overlayRef}
            className="pointer-events-none absolute inset-0 h-full w-full"
            data-testid="overlay-canvas"
          />
          <div
            className="absolute right-2 top-2 rounded-md bg-black/60 px-2 py-1 font-mono text-[10px] tabular-nums text-white backdrop-blur-sm"
            data-testid="monitor-frame-counter"
          >
            {String(frameIndex).padStart(6, '0')}
          </div>
        </>
      ) : (
        <EmptyState permission={permission} />
      )}
    </div>
  );
}

function EmptyState({ permission }: { permission: 'unknown' | 'granted' | 'denied' }) {
  const denied = permission === 'denied';
  return (
    <div className="flex h-full w-full items-center justify-center p-6 text-center">
      <div className="max-w-xs">
        <p className={cn('text-[13px] font-medium', denied ? 'text-danger' : 'text-white/90')}>
          {denied ? 'Camera access blocked' : 'No source selected'}
        </p>
        <p className="mt-1 text-[12px] leading-relaxed text-white/55">
          {denied
            ? 'Allow camera access in your browser’s site settings, then choose the camera again from the toolbar.'
            : 'Pick a camera or open a video file from the Source menu in the toolbar.'}
        </p>
      </div>
    </div>
  );
}
