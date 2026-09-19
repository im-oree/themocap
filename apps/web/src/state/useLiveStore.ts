/**
 * Live session state: the source, the clock readout, and recording status.
 *
 * This holds only what the *UI* needs to render. The actual frame data never
 * passes through here — it lives in the SharedArrayBuffer ring buffers and is
 * read directly by the consumers that need it. Putting pixel or pose data in a
 * React store would be the single easiest way to destroy the frame budget.
 *
 * The clock readout is the one exception, and it is deliberately throttled by
 * its writer (the status bar ticker) rather than updated per frame.
 */

import { create } from 'zustand';

export type SourceKind = 'none' | 'camera' | 'file';

export interface LiveSource {
  kind: SourceKind;
  /** Device label or file name. Never a full path. */
  label: string;
  deviceId?: string;
  width: number;
  height: number;
}

export type CameraPermission = 'unknown' | 'granted' | 'denied';

export type RecordingState =
  | { status: 'idle' }
  | { status: 'recording'; startedAt: number; elapsedSeconds: number }
  | { status: 'saving' };

interface LiveState {
  source: LiveSource;
  setSource: (source: LiveSource) => void;
  clearSource: () => void;

  cameraPermission: CameraPermission;
  setCameraPermission: (permission: CameraPermission) => void;

  /** Master-clock readout, updated at ~10Hz by the status bar, not per frame. */
  frameIndex: number;
  elapsedSeconds: number;
  fps: number;
  setClockReadout: (readout: { frameIndex: number; elapsedSeconds: number; fps: number }) => void;

  playing: boolean;
  setPlaying: (playing: boolean) => void;

  recording: RecordingState;
  setRecording: (recording: RecordingState) => void;
}

const NO_SOURCE: LiveSource = { kind: 'none', label: '', width: 0, height: 0 };

export const useLiveStore = create<LiveState>((set) => ({
  source: NO_SOURCE,
  setSource: (source) => set({ source }),
  clearSource: () => set({ source: NO_SOURCE, playing: false }),

  cameraPermission: 'unknown',
  setCameraPermission: (cameraPermission) => set({ cameraPermission }),

  frameIndex: 0,
  elapsedSeconds: 0,
  fps: 0,
  setClockReadout: ({ frameIndex, elapsedSeconds, fps }) =>
    set({ frameIndex, elapsedSeconds, fps }),

  playing: false,
  setPlaying: (playing) => set({ playing }),

  recording: { status: 'idle' },
  setRecording: (recording) => set({ recording }),
}));

/** Formats seconds as `MM:SS.d`, the form used in the toolbar and status bar. */
export function formatElapsed(seconds: number): string {
  const safe = Number.isFinite(seconds) && seconds > 0 ? seconds : 0;
  const minutes = Math.floor(safe / 60);
  const rest = safe - minutes * 60;
  return `${String(minutes).padStart(2, '0')}:${rest.toFixed(1).padStart(4, '0')}`;
}
