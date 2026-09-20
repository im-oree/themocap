/**
 * Wires capture to storage: start the loop, record a take, save it.
 *
 * The one place that knows the whole sequence — acquire source, load model,
 * run inference, buffer poses, record video, write a complete take to the
 * workspace. Everything it calls already existed; nothing previously joined
 * them up, which is why Record could never produce a file.
 *
 * A module singleton for the same reason `sourceController` is: it owns a
 * `MediaRecorder` and a wasm session, and two of either would be a resource
 * leak rather than a duplicated value.
 */

import { createBackend, detectCapabilities } from '@wms/inference';
import type { ModelSpec } from '@wms/inference/types';
import { manifest } from '@wms/models';

import { getActiveSource } from './sourceController';
import { CaptureLoop, type CaptureFrame } from './captureLoop';
import { PoseEstimator, type FrameSource } from './poseEstimator';
import { MOVENET_KEYPOINTS } from './movenet';
import { useLiveStore } from '../../state/useLiveStore';
import type { WorkspaceManager } from '../workspace/WorkspaceManager';
import type { TakeManifest } from '../workspace/layout';

/** Model id preferred for the live path, falling back to the synthetic stub. */
const LIVE_MODEL_IDS = [
  'movenet-singlepose-lightning-fp32',
  'movenet-singlepose-lightning-stub',
];

export class NoModelError extends Error {
  constructor() {
    super(
      'No 2D pose model is installed. Add one from Preferences, or drop an ONNX file into /models/.',
    );
    this.name = 'NoModelError';
  }
}

/**
 * Picks the best installed pose model.
 *
 * Only entries marked `acquired` are considered: the manifest lists many
 * candidates that have never been downloaded, and trying to load one would
 * fail with a 404 rather than a useful message.
 */
export function resolveLiveModel(): { spec: ModelSpec; synthetic: boolean } | null {
  for (const id of LIVE_MODEL_IDS) {
    const entry = manifest.models.find((m) => m.id === id && m.acquired);
    if (!entry?.sha256 || !entry.sizeBytes) continue;
    return {
      spec: {
        id: entry.id,
        url: entry.file,
        sha256: entry.sha256,
        sizeBytes: entry.sizeBytes,
        precision: entry.precision,
        inputShape: entry.inputShape,
        inputName: entry.inputName,
        outputNames: entry.outputNames,
      },
      // The stub produces a plausible-looking skeleton that is not a pose
      // estimate, so anything recorded with it must be labelled.
      synthetic: entry.id.endsWith('-stub'),
    };
  }
  return null;
}

export interface SessionCallbacks {
  onFrame?: (frame: CaptureFrame) => void;
  onError?: (error: unknown) => void;
}

interface RecordingContext {
  projectId: string;
  takeId: string;
  startedAt: number;
  chunks: Blob[];
  recorder: MediaRecorder | null;
}

class CaptureSession {
  private estimator: PoseEstimator | null = null;
  private loop: CaptureLoop | null = null;
  private recording: RecordingContext | null = null;
  private syntheticModel = false;

  get isRunning(): boolean {
    return this.loop?.isRunning ?? false;
  }

  get isRecording(): boolean {
    return this.recording !== null;
  }

  /** True when the loaded model is the synthetic placeholder. */
  get usingSyntheticModel(): boolean {
    return this.syntheticModel;
  }

  get stats() {
    return this.loop?.stats ?? { processed: 0, dropped: 0, fps: 0 };
  }

  /**
   * Starts inference against the active source.
   *
   * `video` is passed in rather than discovered, because the element belongs to
   * the Video Monitor panel and reaching across the DOM to find it would break
   * the moment the panel is closed or re-docked.
   */
  async start(video: FrameSource, callbacks: SessionCallbacks = {}): Promise<void> {
    if (this.loop?.isRunning) return;

    const model = resolveLiveModel();
    if (!model) throw new NoModelError();
    this.syntheticModel = model.synthetic;

    if (!this.estimator) {
      // Prefer WebGPU when the browser really has it; the wasm backend is the
      // universally-available fallback and is fast enough for a 9MB model.
      const caps = await detectCapabilities();
      const backend = createBackend(caps.webgpu ? 'ort-web-webgpu' : 'ort-web-wasm');
      this.estimator = new PoseEstimator({ backend, spec: model.spec });
      await this.estimator.load();
    }

    this.loop = new CaptureLoop({
      estimator: this.estimator,
      source: video,
      onFrame: callbacks.onFrame,
      onError: callbacks.onError,
      targetFps: 30,
    });
    this.loop.start();
  }

  async stop(): Promise<void> {
    this.loop?.stop();
    this.loop = null;
    await this.estimator?.dispose();
    this.estimator = null;
  }

  /**
   * Begins recording. Allocates the take directory up front so the video
   * writer has somewhere to stream to.
   */
  async startRecording(manager: WorkspaceManager, projectId: string, name: string): Promise<void> {
    if (!this.loop) throw new Error('Capture is not running');
    if (this.recording) return;

    const takeId = await manager.createTake({ projectId, name });
    const source = getActiveSource();

    const context: RecordingContext = {
      projectId,
      takeId,
      startedAt: performance.now(),
      chunks: [],
      recorder: null,
    };

    // Record the camera stream if there is one. A file source is already on
    // disk somewhere, and re-encoding it would be wasted work.
    if (source?.stream && typeof MediaRecorder !== 'undefined') {
      try {
        const recorder = new MediaRecorder(source.stream, { mimeType: pickVideoMimeType() });
        recorder.ondataavailable = (event) => {
          if (event.data.size > 0) context.chunks.push(event.data);
        };
        recorder.start(1000);
        context.recorder = recorder;
      } catch (cause) {
        // Pose data is the valuable output; losing the video reference track is
        // survivable and much better than failing the whole recording.
        console.warn('[capture] video recording unavailable, continuing pose-only', cause);
      }
    }

    this.recording = context;
    this.loop.startRecording(MOVENET_KEYPOINTS, 30);
    useLiveStore.getState().setRecording({
      status: 'recording',
      startedAt: performance.now(),
      elapsedSeconds: 0,
    });
  }

  /** Stops recording and writes a complete, valid take to the workspace. */
  async stopRecording(manager: WorkspaceManager): Promise<TakeManifest | null> {
    const context = this.recording;
    const loop = this.loop;
    this.recording = null;
    if (!context || !loop) return null;

    useLiveStore.getState().setRecording({ status: 'saving' });

    try {
      const videoBlob = await stopRecorder(context);
      const take = loop.finishRecording();
      const durationSeconds = (performance.now() - context.startedAt) / 1000;

      if (!take) {
        // No frames captured — remove the empty directory rather than leaving a
        // take that cannot be opened.
        await manager.deleteTake(context.projectId, context.takeId).catch(() => undefined);
        return null;
      }

      // Write payloads before the manifest: take.json is what makes a take
      // visible, so it must be the last thing written (same ordering rule as
      // the refined-track write in Document 3 §8.3).
      const keypointsWriter = await manager.createKeypointsWriter(
        context.projectId,
        context.takeId,
      );
      await keypointsWriter.write(take.bytes);
      await keypointsWriter.close();

      let videoWritten = false;
      if (videoBlob && videoBlob.size > 0) {
        const videoWriter = await manager.createVideoWriter(context.projectId, context.takeId);
        await videoWriter.write(new Uint8Array(await videoBlob.arrayBuffer()));
        await videoWriter.close();
        videoWritten = true;
      }

      const source = useLiveStore.getState().source;
      const manifestRecord: TakeManifest = {
        version: 1,
        id: context.takeId,
        name: context.takeId,
        projectId: context.projectId,
        createdAt: new Date().toISOString(),
        durationSeconds,
        frameCount: take.frameCount,
        captureFps: 30,
        inferenceFps: durationSeconds > 0 ? take.frameCount / durationSeconds : 0,
        source: {
          kind: source.kind === 'file' ? 'file' : 'camera',
          label: source.label,
          width: source.width,
          height: source.height,
        },
        models: {
          detector: null,
          pose2d: resolveLiveModel()?.spec.id ?? null,
          lift3d: null,
        },
        files: {
          video: videoWritten ? 'video.webm' : null,
          keypoints: 'raw-keypoints.bin',
          thumbnail: null,
        },
        // Nothing has estimated twist yet; the refine pass fills this in.
        twistEstimatedJoints: [],
      };

      await manager.finalizeTake(manifestRecord);
      return manifestRecord;
    } finally {
      useLiveStore.getState().setRecording({ status: 'idle' });
    }
  }
}

/** Waits for the recorder to flush its final chunk. */
function stopRecorder(context: RecordingContext): Promise<Blob | null> {
  const recorder = context.recorder;
  if (!recorder || recorder.state === 'inactive') {
    return Promise.resolve(context.chunks.length ? new Blob(context.chunks) : null);
  }
  return new Promise((resolve) => {
    // `stop` is asynchronous: data queued before it is only delivered on the
    // stop event, so resolving early truncates the tail of the video.
    recorder.onstop = () => resolve(new Blob(context.chunks, { type: recorder.mimeType }));
    recorder.stop();
  });
}

/** Picks a container the browser will actually accept. */
function pickVideoMimeType(): string {
  const candidates = [
    'video/webm;codecs=vp9',
    'video/webm;codecs=vp8',
    'video/webm',
    'video/mp4',
  ];
  for (const type of candidates) {
    if (MediaRecorder.isTypeSupported?.(type)) return type;
  }
  return '';
}

export const captureSession = new CaptureSession();
