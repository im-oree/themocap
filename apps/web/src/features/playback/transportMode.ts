/**
 * What the transport is currently driving (Document 3 §7.1).
 *
 * Document 2 had two implicit modes — a live camera and a video file being
 * processed — distinguished ad hoc at each call site. Document 3 adds a third,
 * `stored-take`, and three implicit modes is one too many to keep straight, so
 * they become an explicit type here.
 *
 * The distinction that actually matters is **where time comes from**:
 *
 *   - `live-camera`: time is wall-clock; there is no duration and no seeking,
 *     because the future has not been recorded yet.
 *   - `file-playback`: time is the video element's clock while frames are being
 *     pushed through inference.
 *   - `stored-take`: time is the take's own recorded per-frame timestamps. This
 *     is the only mode where scrubbing is frame-accurate, and the only one where
 *     the video and the pose data must be kept in step from the same source.
 */

export type TransportMode = 'idle' | 'live-camera' | 'file-playback' | 'stored-take';

/** Modes where the user can scrub to an arbitrary position. */
export function isSeekable(mode: TransportMode): boolean {
  return mode === 'stored-take' || mode === 'file-playback';
}

/**
 * Modes with a known total duration.
 *
 * Live capture has none — the timeline shows elapsed time instead of a
 * proportion, which is why this is separate from `isSeekable`.
 */
export function hasKnownDuration(mode: TransportMode): boolean {
  return mode === 'stored-take' || mode === 'file-playback';
}

/** Modes that run inference. A stored take is already inferred. */
export function runsInference(mode: TransportMode): boolean {
  return mode === 'live-camera' || mode === 'file-playback';
}

/**
 * Where a consumer should read poses from in this mode.
 *
 * This is the switch that `useCurrentPose` consumers use to pick a backend, so
 * the mapping lives here rather than being re-derived at every call site.
 */
export function poseBackendFor(mode: TransportMode): 'live' | 'stored' | 'none' {
  switch (mode) {
    case 'live-camera':
    case 'file-playback':
      return 'live';
    case 'stored-take':
      return 'stored';
    default:
      return 'none';
  }
}
