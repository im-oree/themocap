/**
 * Camera and file source acquisition.
 *
 * These cover the layer whose absence made the toolbar's camera/film buttons
 * inert. The error-classification tests matter as much as the happy path:
 * `getUserMedia`'s DOMException names are not self-explanatory, and mapping
 * them wrong sends a user to the wrong fix.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  CaptureError,
  classifyCaptureError,
  isMediaDevicesSupported,
  listCameras,
  openCamera,
  openVideoFile,
} from '../../src/features/capture/mediaSource';
import {
  closeSource,
  getActiveSource,
  resetSourceControllerForTests,
  selectCamera,
  subscribeToSource,
} from '../../src/features/capture/sourceController';
import { useLiveStore } from '../../src/state/useLiveStore';

/** A MediaStream stand-in that records whether its tracks were stopped. */
function fakeStream(settings: Record<string, unknown> = {}, label = 'FaceTime HD Camera') {
  const track = {
    label,
    stop: vi.fn(),
    getSettings: () => ({ width: 1280, height: 720, deviceId: 'cam-1', ...settings }),
  };
  return {
    stream: { getTracks: () => [track], getVideoTracks: () => [track] } as unknown as MediaStream,
    track,
  };
}

function stubMediaDevices(overrides: Record<string, unknown> = {}) {
  const devices = {
    getUserMedia: vi.fn(),
    enumerateDevices: vi.fn(async () => []),
    ...overrides,
  } as { getUserMedia: ReturnType<typeof vi.fn>; enumerateDevices: ReturnType<typeof vi.fn> };
  vi.stubGlobal('navigator', { mediaDevices: devices });
  return devices;
}

beforeEach(() => {
  resetSourceControllerForTests();
  useLiveStore.setState({
    source: { kind: 'none', label: '', width: 0, height: 0 },
    cameraPermission: 'unknown',
    playing: false,
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('capability detection', () => {
  it('reports unsupported when mediaDevices is absent', () => {
    vi.stubGlobal('navigator', {});
    expect(isMediaDevicesSupported()).toBe(false);
  });

  it('openCamera fails cleanly on an unsupported browser', async () => {
    vi.stubGlobal('navigator', {});
    await expect(openCamera()).rejects.toMatchObject({ code: 'unsupported' });
  });
});

describe('error classification', () => {
  it.each([
    ['NotAllowedError', 'permission-denied'],
    ['SecurityError', 'permission-denied'],
    ['NotFoundError', 'no-device'],
    ['OverconstrainedError', 'no-device'],
    ['NotReadableError', 'in-use'],
    ['AbortError', 'in-use'],
    ['SomethingElse', 'unknown'],
  ])('maps %s to %s', (name, code) => {
    expect(classifyCaptureError(Object.assign(new Error('x'), { name })).code).toBe(code);
  });

  it('explains that NotReadableError means another app holds the camera', () => {
    const error = classifyCaptureError(Object.assign(new Error(), { name: 'NotReadableError' }));
    // The raw name suggests a read failure; the real cause is contention.
    expect(error.message).toMatch(/already in use/i);
  });

  it('gives permission errors an actionable instruction', () => {
    const error = classifyCaptureError(Object.assign(new Error(), { name: 'NotAllowedError' }));
    expect(error.message).toMatch(/browser settings/i);
  });
});

describe('listCameras', () => {
  it('returns only video inputs', async () => {
    stubMediaDevices({
      enumerateDevices: vi.fn(async () => [
        { kind: 'videoinput', deviceId: 'a', label: 'Front' },
        { kind: 'audioinput', deviceId: 'b', label: 'Mic' },
        { kind: 'videoinput', deviceId: 'c', label: 'Back' },
      ]),
    });

    const cameras = await listCameras();
    expect(cameras.map((c) => c.label)).toEqual(['Front', 'Back']);
  });

  it('substitutes a positional name when the label is withheld', async () => {
    // Labels are empty until permission has been granted at least once.
    stubMediaDevices({
      enumerateDevices: vi.fn(async () => [{ kind: 'videoinput', deviceId: 'a', label: '' }]),
    });

    expect((await listCameras())[0]!.label).toBe('Camera 1');
  });

  it('returns nothing rather than throwing on an unsupported browser', async () => {
    vi.stubGlobal('navigator', {});
    await expect(listCameras()).resolves.toEqual([]);
  });
});

describe('openCamera', () => {
  it('requests resolution as ideal, never exact', async () => {
    const { stream } = fakeStream();
    const devices = stubMediaDevices({ getUserMedia: vi.fn(async () => stream) } as never);

    await openCamera({ width: 1920, height: 1080, fps: 60 });

    const constraints = devices.getUserMedia.mock.calls[0]![0] as MediaStreamConstraints;
    const video = constraints.video as MediaTrackConstraints;
    // An `exact` constraint the hardware cannot satisfy fails the whole call,
    // which would report a working 720p webcam as "no camera".
    expect(video.width).toEqual({ ideal: 1920 });
    expect(video.height).toEqual({ ideal: 1080 });
    expect(video.frameRate).toEqual({ ideal: 60 });
    expect(constraints.audio).toBe(false);
  });

  it('reports the real device name and negotiated size', async () => {
    const { stream } = fakeStream({ width: 640, height: 480 }, 'Logitech C920');
    stubMediaDevices({ getUserMedia: vi.fn(async () => stream) } as never);

    const source = await openCamera();

    expect(source.label).toBe('Logitech C920');
    // The negotiated settings win over what was requested.
    expect(source.width).toBe(640);
    expect(source.height).toBe(480);
  });

  it('stops every track on release, so the camera light goes out', async () => {
    const { stream, track } = fakeStream();
    stubMediaDevices({ getUserMedia: vi.fn(async () => stream) } as never);

    const source = await openCamera();
    source.release();

    expect(track.stop).toHaveBeenCalledOnce();
  });

  it('release is idempotent', async () => {
    const { stream, track } = fakeStream();
    stubMediaDevices({ getUserMedia: vi.fn(async () => stream) } as never);

    const source = await openCamera();
    source.release();
    source.release();

    expect(track.stop).toHaveBeenCalledOnce();
  });

  it('surfaces a denied permission as a CaptureError', async () => {
    stubMediaDevices({
      getUserMedia: vi.fn(async () => {
        throw Object.assign(new Error('denied'), { name: 'NotAllowedError' });
      }),
    });

    await expect(openCamera()).rejects.toBeInstanceOf(CaptureError);
  });
});

describe('openVideoFile', () => {
  it('rejects a file that is plainly not a video', async () => {
    const file = new File([new Uint8Array([1])], 'notes.txt', { type: 'text/plain' });
    await expect(openVideoFile(file)).rejects.toMatchObject({ code: 'unsupported' });
  });

  it('accepts by extension when the browser reports no MIME type', async () => {
    // Some platforms hand over an empty `type` for .mov; extension is the
    // fallback signal rather than a hard rejection.
    const file = new File([new Uint8Array([1])], 'clip.mov', { type: '' });
    // It will still fail later at metadata reading in jsdom, but not at the
    // type guard — which is the distinction under test.
    await expect(openVideoFile(file)).rejects.not.toMatchObject({
      message: expect.stringMatching(/does not look like a video/),
    });
  });
});

describe('sourceController', () => {
  it('publishes the acquired source to the live store', async () => {
    const { stream } = fakeStream({ width: 1280, height: 720 }, 'Studio Cam');
    stubMediaDevices({ getUserMedia: vi.fn(async () => stream) } as never);

    await selectCamera();

    const source = useLiveStore.getState().source;
    // This is precisely what was broken: nothing ever set a non-'none' source,
    // so Play/Stop/Record were permanently disabled.
    expect(source.kind).toBe('camera');
    expect(source.label).toBe('Studio Cam');
    expect(source.width).toBe(1280);
    expect(useLiveStore.getState().cameraPermission).toBe('granted');
  });

  it('releases the previous camera when a new one is selected', async () => {
    const first = fakeStream({}, 'First');
    const second = fakeStream({}, 'Second');
    const getUserMedia = vi
      .fn()
      .mockResolvedValueOnce(first.stream)
      .mockResolvedValueOnce(second.stream);
    stubMediaDevices({ getUserMedia } as never);

    await selectCamera();
    await selectCamera({ deviceId: 'other' });

    // Otherwise the first camera stays locked and its light stays on.
    expect(first.track.stop).toHaveBeenCalledOnce();
    expect(second.track.stop).not.toHaveBeenCalled();
    expect(useLiveStore.getState().source.label).toBe('Second');
  });

  it('closeSource releases hardware and clears the store', async () => {
    const { stream, track } = fakeStream();
    stubMediaDevices({ getUserMedia: vi.fn(async () => stream) } as never);

    await selectCamera();
    closeSource();

    expect(track.stop).toHaveBeenCalledOnce();
    expect(useLiveStore.getState().source.kind).toBe('none');
    expect(getActiveSource()).toBeNull();
  });

  it('notifies subscribers, including late ones, of the current source', async () => {
    const { stream } = fakeStream();
    stubMediaDevices({ getUserMedia: vi.fn(async () => stream) } as never);
    const seen: (string | null)[] = [];

    subscribeToSource((s) => seen.push(s?.label ?? null));
    await selectCamera();

    // Immediate null on subscribe, then the acquired camera.
    expect(seen).toEqual([null, 'FaceTime HD Camera']);
  });

  it('a failed open leaves the existing source intact', async () => {
    const { stream } = fakeStream({}, 'Working Cam');
    const getUserMedia = vi
      .fn()
      .mockResolvedValueOnce(stream)
      .mockRejectedValueOnce(Object.assign(new Error(), { name: 'NotReadableError' }));
    stubMediaDevices({ getUserMedia } as never);

    await selectCamera();
    await expect(selectCamera({ deviceId: 'busy' })).rejects.toBeInstanceOf(CaptureError);

    // Losing a working camera because a second one failed would be worse than
    // the failure itself.
    expect(useLiveStore.getState().source.label).toBe('Working Cam');
  });
});
