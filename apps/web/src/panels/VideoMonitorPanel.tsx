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
import { captureSession } from '../features/capture/captureSession';
import { COCO17_EDGES, containRect, drawSkeleton } from '../features/capture/drawSkeleton';
import type { Keypoint } from '../features/capture/movenet';

export function VideoMonitorPanel() {
  const hostRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const [box, setBox] = useState({ width: 0, height: 0 });
  const [captureError, setCaptureError] = useState<string | null>(null);
  const hasSource = useLiveStore((s) => s.source.kind !== 'none');

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

  // `hasSource` is in the deps because the <canvas> is unmounted with the video:
  // a remounted canvas is a brand-new element back at the HTML default 300x150,
  // and CSS-stretching that to the panel distorts everything drawn on it.
  useEffect(() => {
    const canvas = overlayRef.current;
    if (!canvas || box.width === 0) return;
    const dpr = Math.min(window.devicePixelRatio ?? 1, 2);
    canvas.width = Math.round(box.width * dpr);
    canvas.height = Math.round(box.height * dpr);
  }, [box, hasSource]);

  /**
   * Runs inference for as long as a source is attached.
   *
   * Keypoints are painted straight onto the overlay canvas from the callback
   * rather than being pushed through React state: at 30fps a setState per frame
   * is 30 reconciliations a second to redraw a canvas React cannot see.
   */
  useEffect(() => {
    if (!hasSource) return;
    const video = videoRef.current;
    if (!video) return;

    let cancelled = false;
    let latest: Keypoint[] | null = null;

    const paint = () => {
      const canvas = overlayRef.current;
      const ctx = canvas?.getContext('2d');
      if (!canvas || !ctx) return;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      if (!latest) return;

      // Keypoints are normalised to the *source frame*, but the video is drawn
      // with object-contain, so it occupies only part of the panel. Painting
      // across the full canvas would slide the skeleton off the body on any
      // panel whose aspect ratio differs from the camera's.
      const rect = containRect(
        video.videoWidth || 0,
        video.videoHeight || 0,
        canvas.width,
        canvas.height,
      );
      if (!rect) return;
      ctx.save();
      ctx.translate(rect.x, rect.y);
      drawSkeleton(ctx, latest, rect.width, rect.height, COCO17_EDGES);
      ctx.restore();
    };

    void captureSession
      .start(video, {
        onFrame: (frame) => {
          if (cancelled) return;
          latest = frame.keypoints;
          paint();
        },
        onError: (cause) => console.warn('[capture] frame failed', cause),
      })
      .catch((cause) => {
        // A missing model is expected until one is installed; surface it in the
        // panel's own empty state rather than as a crash.
        if (!cancelled) setCaptureError(cause instanceof Error ? cause.message : String(cause));
      });

    return () => {
      cancelled = true;
      void captureSession.stop();
    };
  }, [hasSource]);

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
          {captureError && (
            <p
              role="alert"
              data-testid="capture-error"
              className="absolute inset-x-2 bottom-2 rounded-md bg-danger/90 px-2 py-1.5 text-[11px] leading-snug text-white"
            >
              {captureError}
            </p>
          )}
          {captureSession.usingSyntheticModel && !captureError && (
            <p
              data-testid="synthetic-model-badge"
              className="absolute left-2 top-2 rounded-md bg-warning/90 px-2 py-1 text-[10px] font-medium text-black"
            >
              Synthetic model — not real pose data
            </p>
          )}
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
