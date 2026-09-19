/**
 * Loading a stored take into memory for playback (Document 3 §7.1).
 *
 * Deliberately **not** a React hook: loading a take is an async transaction with
 * resources that must be released in a specific order, and hooks make that
 * ordering implicit. The caller owns the returned handle and must `release()` it.
 */

import { poseTrackFromFrames, type PoseSource, type PoseTrack } from '@wms/take-model';

import { decodeTake } from '../recording/TakeWriter';
import type { WorkspaceManager } from '../workspace/WorkspaceManager';
import type { TakeManifest } from '../workspace/layout';

export interface LoadedTake {
  manifest: TakeManifest;
  /** Object URL for the take's video, or null if it recorded without one. */
  videoUrl: string | null;
  raw: PoseTrack;
  /** Present only when the take has been refined. */
  refined: PoseTrack | null;
  /**
   * Revokes the video object URL. Must be called when the take is closed;
   * object URLs are leaked for the lifetime of the document otherwise, and a
   * session of opening takes would pin every video blob in memory.
   */
  release: () => void;
}

/** Picks a track, falling back to raw when refined was asked for but is absent. */
export function trackFor(take: LoadedTake, source: PoseSource): PoseTrack {
  if (source === 'refined' && take.refined) return take.refined;
  return take.raw;
}

function toTrack(bytes: Uint8Array, fallbackFps: number): PoseTrack {
  const decoded = decodeTake(bytes);
  // The header fps is authoritative, but a take written by a build that left it
  // at zero should still play back rather than dividing by zero downstream.
  const fps = decoded.fps > 0 ? decoded.fps : fallbackFps;
  return poseTrackFromFrames(decoded.frames, decoded.jointCount, fps);
}

/**
 * Reads a take's manifest, video and pose tracks into memory.
 *
 * Order matters: the pose tracks are read first because they are what makes the
 * take usable at all. If the video is missing or unreadable we still return a
 * playable take with `videoUrl: null` — a take whose 3D data survived but whose
 * video did not is worth far more than an error.
 */
export async function loadTake(
  manager: WorkspaceManager,
  projectId: string,
  takeId: string,
): Promise<LoadedTake> {
  const manifest = await manager.readTake(projectId, takeId);
  const fallbackFps = manifest.captureFps > 0 ? manifest.captureFps : 30;

  const rawBytes = await manager.readTakeKeypoints(projectId, takeId);
  const raw = toTrack(rawBytes, fallbackFps);

  let refined: PoseTrack | null = null;
  if (manifest.files.refined && (await manager.hasRefined(projectId, takeId))) {
    try {
      refined = toTrack(await manager.readTakeRefined(projectId, takeId), fallbackFps);
    } catch (cause) {
      // A corrupt refined track must never make a take unopenable; raw is the
      // source of truth and is always intact by construction (§8.3).
      console.warn('[playback] refined track unreadable, falling back to raw', cause);
    }
  }

  let videoUrl: string | null = null;
  if (manifest.files.video) {
    try {
      const bytes = await manager.readTakeVideo(projectId, takeId);
      // Copy into a fresh ArrayBuffer: the provider may hand back a view onto a
      // larger pooled buffer, and Blob would then capture the wrong extent.
      const blob = new Blob([bytes.slice().buffer as ArrayBuffer], { type: 'video/webm' });
      videoUrl = URL.createObjectURL(blob);
    } catch (cause) {
      console.warn('[playback] video unreadable, continuing without it', cause);
    }
  }

  let released = false;
  return {
    manifest,
    videoUrl,
    raw,
    refined,
    release: () => {
      // Idempotent: double-release is easy to cause from React cleanup paths and
      // revoking twice is a silent no-op we would rather make explicit.
      if (released) return;
      released = true;
      if (videoUrl) URL.revokeObjectURL(videoUrl);
    },
  };
}
