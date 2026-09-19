/**
 * Document 3 §7.1: opening a stored take.
 *
 * Writes genuine `WMOC` bytes with the Document 2 encoder and reads them back
 * through the loader, so this is a real round-trip rather than a decode against
 * a hand-rolled fixture that might encode my misunderstanding of the format.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { trackDuration } from '@wms/take-model';

import { WorkspaceManager } from '../../src/features/workspace/WorkspaceManager';
import { OpfsWorkspaceProvider } from '../../src/features/workspace/providers/opfsProvider';
import { encodeFrame, encodeHeader } from '../../src/features/recording/TakeWriter';
import { loadTake, trackFor } from '../../src/features/playback/loadTake';
import type { TakeManifest } from '../../src/features/workspace/layout';
import { MemoryDirectoryHandle } from './memoryFileSystem';

let manager: WorkspaceManager;
let provider: OpfsWorkspaceProvider;

const JOINTS = 3;
const FPS = 30;

/** Builds a valid WMOC byte stream with jittered timestamps. */
function makeWmoc(frameCount: number, scale = 1): Uint8Array {
  const parts: Uint8Array[] = [encodeHeader(frameCount, JOINTS, FPS)];
  let t = 0;
  for (let i = 0; i < frameCount; i += 1) {
    parts.push(
      encodeFrame(
        {
          t,
          kp2d: new Float32Array(JOINTS * 2).fill(i * scale),
          kp3d: new Float32Array(JOINTS * 3).fill(i * scale + 0.5),
          conf: new Float32Array(JOINTS).fill(0.9),
        },
        JOINTS,
      ),
    );
    t += 1 / FPS + (i % 3 === 0 ? 0.002 : 0);
  }
  const total = parts.reduce((sum, p) => sum + p.byteLength, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.byteLength;
  }
  return out;
}

async function seed(options: { video?: boolean; refined?: boolean } = {}) {
  const project = await manager.createProject('Demo');
  const takeId = await manager.createTake({ projectId: project.id, name: 'Take 1' });
  const dir = `projects/${project.id}/takes/${takeId}`;

  await provider.writeFile(`${dir}/raw-keypoints.bin`, makeWmoc(10));
  if (options.video) {
    await provider.writeFile(`${dir}/video.webm`, new Uint8Array([0x1a, 0x45, 0xdf, 0xa3]));
  }

  const manifest: TakeManifest = {
    version: 1,
    id: takeId,
    name: 'Take 1',
    projectId: project.id,
    createdAt: new Date().toISOString(),
    durationSeconds: 10 / FPS,
    frameCount: 10,
    captureFps: FPS,
    inferenceFps: 15,
    source: { kind: 'camera', label: 'cam', width: 640, height: 480 },
    models: { detector: null, pose2d: null, lift3d: null },
    files: {
      video: options.video ? 'video.webm' : null,
      keypoints: 'raw-keypoints.bin',
      thumbnail: null,
    },
    twistEstimatedJoints: [],
  };
  await manager.finalizeTake(manifest);

  if (options.refined) {
    await manager.writeTakeRefined(project.id, takeId, makeWmoc(10, 2));
  }
  return { projectId: project.id, takeId };
}

beforeEach(async () => {
  const root = new MemoryDirectoryHandle('ws');
  vi.stubGlobal('navigator', {
    storage: { getDirectory: async () => root, estimate: async () => ({ usage: 0 }) },
  });
  provider = new OpfsWorkspaceProvider();
  await provider.requestAccess();
  manager = new WorkspaceManager(provider);
  await manager.initialize();

  // jsdom has no object-URL implementation.
  const created: string[] = [];
  vi.stubGlobal('URL', {
    ...URL,
    createObjectURL: vi.fn(() => {
      const url = `blob:fake-${created.length}`;
      created.push(url);
      return url;
    }),
    revokeObjectURL: vi.fn(),
  });
});

describe('loadTake', () => {
  it('decodes the raw track into a PoseTrack', async () => {
    const { projectId, takeId } = await seed();
    const take = await loadTake(manager, projectId, takeId);

    expect(take.raw.frameCount).toBe(10);
    expect(take.raw.jointCount).toBe(JOINTS);
    expect(take.raw.fps).toBe(FPS);
    expect(take.raw.kp3d).not.toBeNull();
    expect(trackDuration(take.raw)).toBeGreaterThan(0);
  });

  it('preserves the captured per-frame timestamps, not a nominal grid', async () => {
    const { projectId, takeId } = await seed();
    const take = await loadTake(manager, projectId, takeId);

    // The fixture nudges every third frame late; a nominal index/fps model
    // would erase that, and seeking would drift.
    const nominal = 9 / FPS;
    expect(take.raw.timestamps[9]).toBeGreaterThan(nominal);
  });

  it('creates a video object URL when the take has video', async () => {
    const { projectId, takeId } = await seed({ video: true });
    const take = await loadTake(manager, projectId, takeId);

    expect(take.videoUrl).toMatch(/^blob:/);
    take.release();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith(take.videoUrl);
  });

  it('release is idempotent', async () => {
    const { projectId, takeId } = await seed({ video: true });
    const take = await loadTake(manager, projectId, takeId);

    take.release();
    take.release();
    take.release();

    // Double-revoking is easy to trigger from React cleanup; do it once only.
    expect(URL.revokeObjectURL).toHaveBeenCalledTimes(1);
  });

  it('opens a take whose video is missing rather than failing', async () => {
    const { projectId, takeId } = await seed({ video: false });
    const take = await loadTake(manager, projectId, takeId);

    // Pose data that survived is worth far more than an error about the video.
    expect(take.videoUrl).toBeNull();
    expect(take.raw.frameCount).toBe(10);
  });

  it('loads the refined track when present', async () => {
    const { projectId, takeId } = await seed({ refined: true });
    const take = await loadTake(manager, projectId, takeId);

    expect(take.refined).not.toBeNull();
    expect(take.refined!.frameCount).toBe(10);
    // The refined fixture doubles the coordinate scale, so the tracks differ.
    expect(take.refined!.kp2d[6]).not.toBeCloseTo(take.raw.kp2d[6]!, 3);
  });

  it('leaves refined null when the take has never been refined', async () => {
    const { projectId, takeId } = await seed();
    expect((await loadTake(manager, projectId, takeId)).refined).toBeNull();
  });

  it('falls back to raw when the refined track is corrupt', async () => {
    const { projectId, takeId } = await seed({ refined: true });
    await provider.writeFile(
      `projects/${projectId}/takes/${takeId}/refined.bin`,
      new Uint8Array([0, 1, 2, 3]),
    );

    const take = await loadTake(manager, projectId, takeId);

    // Raw is intact by construction (§8.3), so a bad refined file must degrade
    // to raw, never make the take unopenable.
    expect(take.refined).toBeNull();
    expect(take.raw.frameCount).toBe(10);
  });
});

describe('trackFor', () => {
  it('returns the requested track', async () => {
    const { projectId, takeId } = await seed({ refined: true });
    const take = await loadTake(manager, projectId, takeId);

    expect(trackFor(take, 'raw')).toBe(take.raw);
    expect(trackFor(take, 'refined')).toBe(take.refined);
  });

  it('falls back to raw when refined is requested but absent', async () => {
    const { projectId, takeId } = await seed();
    const take = await loadTake(manager, projectId, takeId);

    expect(trackFor(take, 'refined')).toBe(take.raw);
  });
});
