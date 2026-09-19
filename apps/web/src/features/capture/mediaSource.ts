/**
 * Acquiring a camera or video-file source.
 *
 * This is the piece that was missing: the toolbar's camera and film buttons had
 * no implementation behind them, so `source.kind` could never leave `'none'`
 * and every downstream control (Play, Stop, Record) stayed permanently
 * disabled. Everything here exists to make `useLiveStore.setSource` reachable.
 *
 * Kept free of React so it can be unit-tested against a fake `navigator`, and
 * so the ownership of a `MediaStream` — which must be explicitly stopped or the
 * camera light stays on — is not tangled up in effect cleanup ordering.
 */

export interface CameraDevice {
  deviceId: string;
  label: string;
}

/** A live source plus the teardown that releases the underlying hardware. */
export interface AcquiredSource {
  kind: 'camera' | 'file';
  label: string;
  deviceId?: string;
  /** Set for camera sources; null for files, which play from an object URL. */
  stream: MediaStream | null;
  /** Set for file sources. */
  objectUrl: string | null;
  width: number;
  height: number;
  /** Releases the camera and/or revokes the object URL. Idempotent. */
  release: () => void;
}

export type CaptureErrorCode =
  | 'unsupported'
  | 'permission-denied'
  | 'no-device'
  | 'in-use'
  | 'unknown';

export class CaptureError extends Error {
  readonly code: CaptureErrorCode;

  constructor(message: string, code: CaptureErrorCode, cause?: unknown) {
    super(message, { cause });
    this.name = 'CaptureError';
    this.code = code;
  }
}

export function isMediaDevicesSupported(): boolean {
  return (
    typeof navigator !== 'undefined' &&
    typeof navigator.mediaDevices?.getUserMedia === 'function'
  );
}

/**
 * Maps a `getUserMedia` rejection to something worth showing a user.
 *
 * The raw DOMException names are not self-explanatory ("NotReadableError"
 * actually means another app holds the camera), and getting this wrong sends
 * people to the wrong fix.
 */
export function classifyCaptureError(cause: unknown): CaptureError {
  const name = (cause as { name?: string })?.name ?? '';
  switch (name) {
    case 'NotAllowedError':
    case 'SecurityError':
      return new CaptureError(
        'Camera access was blocked. Allow camera access for this site in your browser settings, then try again.',
        'permission-denied',
        cause,
      );
    case 'NotFoundError':
    case 'OverconstrainedError':
      return new CaptureError(
        'No camera was found. Connect a camera and try again.',
        'no-device',
        cause,
      );
    case 'NotReadableError':
    case 'AbortError':
      return new CaptureError(
        'The camera is already in use by another application. Close it and try again.',
        'in-use',
        cause,
      );
    default:
      return new CaptureError(
        cause instanceof Error ? cause.message : 'Could not start the camera.',
        'unknown',
        cause,
      );
  }
}

/**
 * Lists available cameras.
 *
 * Labels are empty until permission has been granted at least once — that is a
 * privacy feature of the platform, not a bug — so callers get a positional
 * fallback name rather than a blank menu entry.
 */
export async function listCameras(): Promise<CameraDevice[]> {
  if (!isMediaDevicesSupported() || typeof navigator.mediaDevices.enumerateDevices !== 'function') {
    return [];
  }
  const devices = await navigator.mediaDevices.enumerateDevices();
  return devices
    .filter((device) => device.kind === 'videoinput')
    .map((device, index) => ({
      deviceId: device.deviceId,
      label: device.label || `Camera ${index + 1}`,
    }));
}

export interface CameraRequest {
  deviceId?: string;
  width?: number;
  height?: number;
  fps?: number;
}

/**
 * Opens a camera stream.
 *
 * Resolution and frame rate are requested as `ideal`, never `exact`: an `exact`
 * constraint the hardware cannot meet fails the whole call, which would leave a
 * perfectly usable 720p webcam reported as "no camera" purely because 1080p was
 * unavailable.
 */
export async function openCamera(request: CameraRequest = {}): Promise<AcquiredSource> {
  if (!isMediaDevicesSupported()) {
    throw new CaptureError(
      'This browser does not support camera capture. Try a recent Chrome, Edge or Safari.',
      'unsupported',
    );
  }

  const { deviceId, width = 1280, height = 720, fps = 30 } = request;
  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: {
        ...(deviceId ? { deviceId: { exact: deviceId } } : {}),
        width: { ideal: width },
        height: { ideal: height },
        frameRate: { ideal: fps },
      },
    });
  } catch (cause) {
    throw classifyCaptureError(cause);
  }

  const track = stream.getVideoTracks()[0];
  const settings = track?.getSettings?.() ?? {};

  let released = false;
  return {
    kind: 'camera',
    // The track label is the real device name; fall back if it is withheld.
    label: track?.label || 'Camera',
    deviceId: settings.deviceId ?? deviceId,
    stream,
    objectUrl: null,
    width: settings.width ?? width,
    height: settings.height ?? height,
    release: () => {
      if (released) return;
      released = true;
      // Every track must be stopped individually; dropping the reference to the
      // MediaStream alone leaves the camera active and its indicator light on.
      for (const t of stream.getTracks()) t.stop();
    },
  };
}

/** Video container types we will attempt to open. */
const ACCEPTED_VIDEO = /^video\//;

/**
 * Wraps a user-selected file as a source.
 *
 * Dimensions are read by letting a detached `<video>` load just enough of the
 * file to report them, because the pipeline needs to size its buffers before
 * the first frame is processed.
 */
export async function openVideoFile(file: File): Promise<AcquiredSource> {
  if (!ACCEPTED_VIDEO.test(file.type) && !/\.(webm|mp4|mov|m4v|ogv)$/i.test(file.name)) {
    throw new CaptureError(
      `"${file.name}" does not look like a video file.`,
      'unsupported',
    );
  }

  const objectUrl = URL.createObjectURL(file);
  let dimensions: { width: number; height: number };
  try {
    dimensions = await readVideoDimensions(objectUrl);
  } catch (cause) {
    URL.revokeObjectURL(objectUrl);
    throw new CaptureError(
      `Could not read "${file.name}". The format may not be supported by this browser.`,
      'unsupported',
      cause,
    );
  }

  let released = false;
  return {
    kind: 'file',
    label: file.name,
    stream: null,
    objectUrl,
    width: dimensions.width,
    height: dimensions.height,
    release: () => {
      if (released) return;
      released = true;
      URL.revokeObjectURL(objectUrl);
    },
  };
}

/** Loads metadata only, to learn the intrinsic size of a video. */
export function readVideoDimensions(
  src: string,
  timeoutMs = 10_000,
): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const video = document.createElement('video');
    video.preload = 'metadata';
    video.muted = true;

    const cleanup = () => {
      clearTimeout(timer);
      video.removeEventListener('loadedmetadata', onLoaded);
      video.removeEventListener('error', onError);
      // Detach the source so the element can be collected promptly.
      video.src = '';
    };
    const onLoaded = () => {
      const size = { width: video.videoWidth, height: video.videoHeight };
      cleanup();
      if (size.width === 0 || size.height === 0) {
        reject(new Error('Video reported zero dimensions'));
        return;
      }
      resolve(size);
    };
    const onError = () => {
      cleanup();
      reject(video.error ?? new Error('Video failed to load'));
    };
    // A file the decoder cannot handle may fire neither event.
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error('Timed out reading video metadata'));
    }, timeoutMs);

    video.addEventListener('loadedmetadata', onLoaded);
    video.addEventListener('error', onError);
    video.src = src;
  });
}
