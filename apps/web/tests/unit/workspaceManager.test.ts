/**
 * Project/take bookkeeping, including the §17 acceptance criterion:
 * "a 10s take round-trips to a valid take.json / video / raw-keypoints.bin".
 *
 * These run against the OPFS provider backed by the in-memory directory fake,
 * because it is the tier with real streaming writes and no picker — the closest
 * analogue of what the recorder actually does at runtime.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';

import { TakeWriter, decodeTake } from '../../src/features/recording/TakeWriter';
import {
  slugify,
  takeIdFor,
  takeKeypointsPath,
  takeManifestPath,
  takeVideoPath,
  uniqueSlug,
  WORKSPACE_VERSION,
  type TakeManifest,
} from '../../src/features/workspace/layout';
import { OpfsWorkspaceProvider } from '../../src/features/workspace/providers/opfsProvider';
import { WorkspaceManager } from '../../src/features/workspace/WorkspaceManager';
import { MemoryDirectoryHandle } from './memoryFileSystem';

async function freshManager() {
  const root = new MemoryDirectoryHandle('ws');
  vi.stubGlobal('navigator', {
    storage: { getDirectory: async () => root, estimate: async () => ({ usage: 0 }) },
  });
  const provider = new OpfsWorkspaceProvider();
  await provider.requestAccess();
  const manager = new WorkspaceManager(provider);
  await manager.initialize();
  return { manager, provider };
}

describe('layout helpers', () => {
  it('slugifies display names into filesystem-safe ids', () => {
    expect(slugify('My First Take')).toBe('my-first-take');
    expect(slugify('Café  Session #2!')).toBe('cafe-session-2');
    expect(slugify('   ')).toBe('untitled');
    expect(slugify('!!!')).toBe('untitled');
  });

  it('truncates very long names so no filesystem rejects them', () => {
    expect(slugify('a'.repeat(200)).length).toBeLessThanOrEqual(48);
  });

  it('never emits leading or trailing dashes', () => {
    expect(slugify('  -hello-  ')).toBe('hello');
  });

  it('disambiguates collisions with a numeric suffix', () => {
    expect(uniqueSlug('take', [])).toBe('take');
    expect(uniqueSlug('take', ['take'])).toBe('take-2');
    expect(uniqueSlug('take', ['take', 'take-2', 'take-3'])).toBe('take-4');
  });

  it('prefixes take ids with a sortable timestamp', () => {
    const id = takeIdFor(new Date(2026, 8, 19, 14, 5, 3), 'Jump Test');
    expect(id).toBe('20260919-140503-jump-test');
  });

  it('sorts take ids chronologically as plain strings', () => {
    const early = takeIdFor(new Date(2026, 0, 2, 9, 0, 0), 'b');
    const late = takeIdFor(new Date(2026, 10, 2, 9, 0, 0), 'a');
    expect([late, early].sort()).toEqual([early, late]);
  });
});

describe('WorkspaceManager', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('writes workspace.json and projects/ on first initialize', async () => {
    const { manager, provider } = await freshManager();
    expect(await provider.exists('workspace.json')).toBe(true);
    expect(await provider.exists('projects')).toBe(true);
    const manifest = JSON.parse(await provider.readText('workspace.json'));
    expect(manifest.version).toBe(WORKSPACE_VERSION);
    expect(manifest.app).toBe('web-mocap-studio');
    void manager;
  });

  it('is idempotent and does not clobber an existing workspace', async () => {
    const { manager, provider } = await freshManager();
    const first = JSON.parse(await provider.readText('workspace.json'));
    await manager.initialize();
    const second = JSON.parse(await provider.readText('workspace.json'));
    expect(second.createdAt).toBe(first.createdAt);
  });

  it('refuses a workspace written by a newer app version', async () => {
    const { manager, provider } = await freshManager();
    await provider.writeText('workspace.json', JSON.stringify({ version: 99 }));
    await expect(manager.initialize()).rejects.toMatchObject({ code: 'unsupported' });
  });

  it('creates and reads back a project', async () => {
    const { manager } = await freshManager();
    const project = await manager.createProject('Dance Session');
    expect(project.id).toBe('dance-session');
    expect(await manager.readProject('dance-session')).toEqual(project);
    expect(await manager.listProjectIds()).toEqual(['dance-session']);
  });

  it('disambiguates two projects with the same display name', async () => {
    const { manager } = await freshManager();
    const a = await manager.createProject('Session');
    const b = await manager.createProject('Session');
    expect(a.id).toBe('session');
    expect(b.id).toBe('session-2');
    expect((await manager.listProjectIds()).sort()).toEqual(['session', 'session-2']);
  });

  it('ensureProject returns the existing project instead of a duplicate', async () => {
    const { manager } = await freshManager();
    const created = await manager.createProject('Studio');
    const found = await manager.ensureProject('Studio');
    expect(found.id).toBe(created.id);
    expect(await manager.listProjectIds()).toEqual(['studio']);
  });

  it('reports a missing project rather than returning undefined', async () => {
    const { manager } = await freshManager();
    await expect(manager.readProject('ghost')).rejects.toMatchObject({ code: 'not-found' });
  });

  it('refuses to create a take in a project that does not exist', async () => {
    const { manager } = await freshManager();
    await expect(manager.createTake({ projectId: 'ghost', name: 'x' })).rejects.toMatchObject({
      code: 'not-found',
    });
  });

  it('lists takes in chronological order', async () => {
    const { manager } = await freshManager();
    await manager.createProject('P');
    const t2 = await manager.createTake({
      projectId: 'p',
      name: 'second',
      now: new Date(2026, 5, 2, 10, 0, 0),
    });
    const t1 = await manager.createTake({
      projectId: 'p',
      name: 'first',
      now: new Date(2026, 5, 1, 10, 0, 0),
    });
    expect(await manager.listTakeIds('p')).toEqual([t1, t2]);
  });

  it('returns an empty take list for a project with no takes', async () => {
    const { manager } = await freshManager();
    await manager.createProject('Empty');
    expect(await manager.listTakeIds('empty')).toEqual([]);
  });
});

describe('take round-trip (§17)', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('writes a 10s take and reads back a valid manifest, video and keypoints', async () => {
    const { manager, provider } = await freshManager();
    await manager.createProject('Acceptance');
    const takeId = await manager.createTake({
      projectId: 'acceptance',
      name: 'ten seconds',
      now: new Date(2026, 8, 19, 12, 0, 0),
    });

    const FPS = 30;
    const FRAMES = 300; // 10 seconds
    const JOINTS = 17;

    // --- video: streamed in chunks, exactly as MediaRecorder delivers it ---
    const videoWriter = await manager.createVideoWriter('acceptance', takeId);
    let videoBytes = 0;
    for (let i = 0; i < 20; i += 1) {
      const chunk = new Uint8Array(1024).fill(i);
      videoBytes += chunk.byteLength;
      await videoWriter.write(chunk);
    }
    await videoWriter.close();

    // --- poses: WMOC v1 ---
    const poses = new TakeWriter(JOINTS, FPS);
    for (let f = 0; f < FRAMES; f += 1) {
      const kp2d = new Float32Array(JOINTS * 2);
      const kp3d = new Float32Array(JOINTS * 3);
      const conf = new Float32Array(JOINTS).fill(0.9);
      for (let j = 0; j < JOINTS; j += 1) {
        kp2d[j * 2] = j * 10 + f;
        kp2d[j * 2 + 1] = j * 20 - f;
        kp3d[j * 3 + 1] = 1 + j / 100;
      }
      poses.push({ t: f / FPS, kp2d, kp3d, conf });
    }
    const keypointsWriter = await manager.createKeypointsWriter('acceptance', takeId);
    await keypointsWriter.write(poses.finish());
    await keypointsWriter.close();

    // --- manifest ---
    const manifest: TakeManifest = {
      version: WORKSPACE_VERSION,
      id: takeId,
      name: 'ten seconds',
      projectId: 'acceptance',
      createdAt: new Date(2026, 8, 19, 12, 0, 0).toISOString(),
      durationSeconds: FRAMES / FPS,
      frameCount: FRAMES,
      captureFps: FPS,
      inferenceFps: 26.4,
      source: { kind: 'camera', label: 'FaceTime HD', width: 640, height: 480 },
      models: { detector: null, pose2d: 'rtmpose-t', lift3d: 'motionbert-lite' },
      files: { video: 'video.webm', keypoints: 'raw-keypoints.bin', thumbnail: null },
      twistEstimatedJoints: ['LeftForeArm', 'RightForeArm'],
    };
    await manager.finalizeTake(manifest);

    // --- assertions: everything is on disk where take.json says it is ---
    expect(await provider.exists(takeManifestPath('acceptance', takeId))).toBe(true);
    expect(await provider.exists(takeVideoPath('acceptance', takeId))).toBe(true);
    expect(await provider.exists(takeKeypointsPath('acceptance', takeId))).toBe(true);

    expect(await manager.validateTake('acceptance', takeId)).toEqual([]);

    const readManifest = await manager.readTake('acceptance', takeId);
    expect(readManifest).toEqual(manifest);
    expect(readManifest.durationSeconds).toBeCloseTo(10, 6);

    const video = await provider.readFile(takeVideoPath('acceptance', takeId));
    expect(video.byteLength).toBe(videoBytes);
    expect(video[0]).toBe(0);
    expect(video[19 * 1024]).toBe(19);

    const decoded = decodeTake(await manager.readTakeKeypoints('acceptance', takeId));
    expect(decoded.frames).toHaveLength(FRAMES);
    expect(decoded.jointCount).toBe(JOINTS);
    expect(decoded.fps).toBe(FPS);
    expect(decoded.frames[299]!.t).toBeCloseTo(299 / 30, 9);
    expect(decoded.frames[299]!.kp2d[0]).toBe(299);
    expect(decoded.frames[0]!.kp3d![1]).toBe(1);

    // The take must also appear in the project's listing.
    expect(await manager.listTakeIds('acceptance')).toEqual([takeId]);
  });

  it('carries the twist caveat into the manifest so an export stays honest', async () => {
    const { manager } = await freshManager();
    await manager.createProject('P');
    const takeId = await manager.createTake({ projectId: 'p', name: 't' });
    await manager.finalizeTake({
      version: WORKSPACE_VERSION,
      id: takeId,
      name: 't',
      projectId: 'p',
      createdAt: new Date().toISOString(),
      durationSeconds: 1,
      frameCount: 30,
      captureFps: 30,
      inferenceFps: 25,
      source: { kind: 'file', label: 'clip.mp4', width: 1920, height: 1080 },
      models: { detector: null, pose2d: null, lift3d: null },
      files: { video: null, keypoints: null, thumbnail: null },
      twistEstimatedJoints: ['LeftForeArm'],
    });
    const read = await manager.readTake('p', takeId);
    expect(read.twistEstimatedJoints).toEqual(['LeftForeArm']);
  });

  it('deletes a take and everything under it', async () => {
    const { manager, provider } = await freshManager();
    await manager.createProject('P');
    const takeId = await manager.createTake({ projectId: 'p', name: 't' });
    const writer = await manager.createVideoWriter('p', takeId);
    await writer.write(new Uint8Array([1, 2, 3]));
    await writer.close();

    await manager.deleteTake('p', takeId);
    expect(await provider.exists(takeVideoPath('p', takeId))).toBe(false);
    expect(await manager.listTakeIds('p')).toEqual([]);
  });
});

describe('validateTake reports damage instead of throwing', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('flags a take with no manifest', async () => {
    const { manager } = await freshManager();
    await manager.createProject('P');
    const takeId = await manager.createTake({ projectId: 'p', name: 't' });
    expect(await manager.validateTake('p', takeId)).toEqual(['take.json is missing']);
  });

  it('flags a manifest whose id does not match its folder', async () => {
    const { manager, provider } = await freshManager();
    await manager.createProject('P');
    const takeId = await manager.createTake({ projectId: 'p', name: 't' });
    // Write the manifest directly into the real folder but with the wrong id
    // inside, which is what a partially-renamed take on disk looks like.
    await provider.writeText(
      takeManifestPath('p', takeId),
      JSON.stringify({
        version: 1,
        id: 'wrong-id',
        name: 't',
        projectId: 'other-project',
        createdAt: new Date().toISOString(),
        durationSeconds: 1,
        frameCount: 1,
        captureFps: 30,
        inferenceFps: 30,
        source: { kind: 'camera', label: 'cam', width: 640, height: 480 },
        models: { detector: null, pose2d: null, lift3d: null },
        files: { video: null, keypoints: null, thumbnail: null },
        twistEstimatedJoints: [],
      }),
    );

    const problems = await manager.validateTake('p', takeId);
    expect(problems).toContain(`take.json id "wrong-id" != folder "${takeId}"`);
    expect(problems).toContain('take.json projectId does not match');
  });

  it('flags a manifest that is not valid JSON', async () => {
    const { manager, provider } = await freshManager();
    await manager.createProject('P');
    const takeId = await manager.createTake({ projectId: 'p', name: 't' });
    await provider.writeText(takeManifestPath('p', takeId), 'not json at all');
    const problems = await manager.validateTake('p', takeId);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatch(/not valid JSON/);
  });

  it('flags missing referenced files and a bad keypoints magic', async () => {
    const { manager, provider } = await freshManager();
    await manager.createProject('P');
    const takeId = await manager.createTake({ projectId: 'p', name: 't' });

    await provider.writeFile(
      takeKeypointsPath('p', takeId),
      new Uint8Array(32), // right length, wrong magic
    );
    await manager.finalizeTake({
      version: 1,
      id: takeId,
      name: 't',
      projectId: 'p',
      createdAt: new Date().toISOString(),
      durationSeconds: 0,
      frameCount: 0,
      captureFps: 30,
      inferenceFps: 0,
      source: { kind: 'camera', label: 'cam', width: 640, height: 480 },
      models: { detector: null, pose2d: null, lift3d: null },
      files: { video: 'video.webm', keypoints: 'raw-keypoints.bin', thumbnail: null },
      twistEstimatedJoints: [],
    });

    const problems = await manager.validateTake('p', takeId);
    expect(problems).toContain('frameCount is not positive');
    expect(problems).toContain('durationSeconds is not positive');
    expect(problems).toContain('video file referenced by take.json is missing');
    expect(problems).toContain('keypoints file has a bad WMOC magic');
  });

  it('flags a keypoints file too short to hold a header', async () => {
    const { manager, provider } = await freshManager();
    await manager.createProject('P');
    const takeId = await manager.createTake({ projectId: 'p', name: 't' });
    await provider.writeFile(takeKeypointsPath('p', takeId), new Uint8Array(4));
    await manager.finalizeTake({
      version: 1,
      id: takeId,
      name: 't',
      projectId: 'p',
      createdAt: new Date().toISOString(),
      durationSeconds: 1,
      frameCount: 1,
      captureFps: 30,
      inferenceFps: 30,
      source: { kind: 'camera', label: 'cam', width: 640, height: 480 },
      models: { detector: null, pose2d: null, lift3d: null },
      files: { video: null, keypoints: 'raw-keypoints.bin', thumbnail: null },
      twistEstimatedJoints: [],
    });
    expect(await manager.validateTake('p', takeId)).toContain(
      'keypoints file is shorter than a WMOC header',
    );
  });
});
