/**
 * Frame source for the fixture clips.
 *
 * Primary path is WebCodecs (`VideoDecoder`) via demuxed samples; since a full MP4
 * demuxer is out of scope for internal tooling, we use the equivalent supported
 * route: decode the clip with an off-screen <video> element and pull frames with
 * `VideoFrame`/`drawImage`. Throughput is measured uncapped by seeking rather than
 * playing in realtime, so this measures model capacity, not playback pacing.
 */

export interface FrameSource {
  width: number;
  height: number;
  frameCount: number;
  /** Renders frame `index` into the provided 2D context, letterboxed by the caller. */
  seekTo(index: number): Promise<CanvasImageSource>;
  dispose(): void;
}

export interface FrameSourceOptions {
  /** Target number of frames to sample across the clip. */
  sampleCount?: number;
}

export async function createVideoFrameSource(
  url: string,
  options: FrameSourceOptions = {},
): Promise<FrameSource> {
  const video = document.createElement('video');
  video.src = url;
  video.muted = true;
  video.playsInline = true;
  video.preload = 'auto';
  video.crossOrigin = 'anonymous';

  await new Promise<void>((resolve, reject) => {
    video.onloadedmetadata = () => resolve();
    video.onerror = () => reject(new Error(`Failed to load fixture clip: ${url}`));
  });

  // Ensure the first frame is actually decoded before we start sampling.
  await new Promise<void>((resolve) => {
    if (video.readyState >= 2) return resolve();
    video.oncanplay = () => resolve();
  });

  const duration = video.duration;
  const frameCount = options.sampleCount ?? Math.max(1, Math.round(duration * 30));

  return {
    width: video.videoWidth,
    height: video.videoHeight,
    frameCount,
    async seekTo(index: number) {
      const t = (index / frameCount) * duration;
      await new Promise<void>((resolve) => {
        const onSeeked = () => {
          video.removeEventListener('seeked', onSeeked);
          resolve();
        };
        video.addEventListener('seeked', onSeeked);
        video.currentTime = Math.min(t, Math.max(0, duration - 1e-3));
      });
      return video;
    },
    dispose() {
      video.pause();
      video.removeAttribute('src');
      video.load();
    },
  };
}

/** Deterministic synthetic frames, used when no fixture clip is present locally. */
export function createSyntheticFrameSource(
  width: number,
  height: number,
  frameCount: number,
): FrameSource {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d')!;

  return {
    width,
    height,
    frameCount,
    async seekTo(index: number) {
      const phase = (index / frameCount) * Math.PI * 2;
      ctx.fillStyle = '#202024';
      ctx.fillRect(0, 0, width, height);
      // A crude moving figure so the pixels aren't uniform (affects nothing but realism).
      ctx.fillStyle = '#c8c8d0';
      const cx = width / 2 + Math.sin(phase) * width * 0.15;
      ctx.beginPath();
      ctx.arc(cx, height * 0.25, height * 0.06, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillRect(cx - width * 0.03, height * 0.32, width * 0.06, height * 0.3);
      return canvas;
    },
    dispose() {},
  };
}
