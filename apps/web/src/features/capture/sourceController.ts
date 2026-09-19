/**
 * Owns the one active capture source and keeps `useLiveStore` in step with it.
 *
 * A module-level singleton rather than React state, deliberately. The thing
 * being tracked is a `MediaStream` holding real hardware: if two components
 * each opened one, the camera light would stay on after the first was
 * discarded. One owner, one release path.
 *
 * React reads the *description* of the source from the store; the stream object
 * itself is handed to the `<video>` element directly, because putting a
 * MediaStream in a store invites stale references to released hardware.
 */

import { useLiveStore } from '../../state/useLiveStore';
import {
  openCamera,
  openVideoFile,
  type AcquiredSource,
  type CameraRequest,
} from './mediaSource';

let active: AcquiredSource | null = null;

/** Subscribers are notified whenever the active source is swapped. */
type Listener = (source: AcquiredSource | null) => void;
const listeners = new Set<Listener>();

export function subscribeToSource(listener: Listener): () => void {
  listeners.add(listener);
  // Emit the current value immediately so a late subscriber is not blank until
  // the next change.
  listener(active);
  return () => listeners.delete(listener);
}

function emit() {
  for (const listener of listeners) listener(active);
}

export function getActiveSource(): AcquiredSource | null {
  return active;
}

/**
 * Releases whatever is currently open.
 *
 * Always called before opening something new: switching from the camera to a
 * file must free the camera, or the indicator light stays on and the device
 * remains locked against other applications.
 */
export function closeSource(): void {
  if (active) {
    active.release();
    active = null;
    emit();
  }
  useLiveStore.getState().clearSource();
}

function adopt(source: AcquiredSource) {
  // Release the previous source *after* the new one is acquired, so a failed
  // open does not leave the user with nothing.
  if (active) active.release();
  active = source;
  useLiveStore.getState().setSource({
    kind: source.kind,
    label: source.label,
    deviceId: source.deviceId,
    width: source.width,
    height: source.height,
  });
  emit();
  return source;
}

export async function selectCamera(request: CameraRequest = {}): Promise<AcquiredSource> {
  const source = await openCamera(request);
  // Reaching here means the permission prompt resolved affirmatively.
  useLiveStore.getState().setCameraPermission('granted');
  return adopt(source);
}

export async function selectVideoFile(file: File): Promise<AcquiredSource> {
  return adopt(await openVideoFile(file));
}

/** Test seam: drops the singleton without touching real hardware. */
export function resetSourceControllerForTests(): void {
  active = null;
  listeners.clear();
}
