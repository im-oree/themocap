/**
 * Document 3 §6.1 / §8.3: take lifecycle and refined-write atomicity.
 *
 * Runs against the real `memoryFileSystem` provider rather than a mock, so the
 * path handling, directory creation and delete semantics are genuinely
 * exercised — a mocked provider would happily accept paths no real tier allows.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { REFINE_DEFAULTS, withTakeSettingsDefaults } from '@wms/take-model';

import { WorkspaceManager } from '../../src/features/workspace/WorkspaceManager';
import {
  takeRefinedPath,
  takeRefinedTmpPath,
  type TakeManifest,
} from '../../src/features/workspace/layout';
import { OpfsWorkspaceProvider } from '../../src/features/workspace/providers/opfsProvider';
import { MemoryDirectoryHandle } from './memoryFileSystem';
import type { WorkspaceProvider } from '../../src/features/workspace/types';

let provider: WorkspaceProvider;
let manager: WorkspaceManager;

async function seedTake(projectId = 'demo', takeName = 'Take 1') {
  const project = await manager.createProject(projectId);
  const takeId = await manager.createTake({ projectId: project.id, name: takeName });
  const manifest: TakeManifest = {
    version: 1,
    id: takeId,
    name: takeName,
    projectId: project.id,
    createdAt: new Date().toISOString(),
    durationSeconds: 10,
    frameCount: 300,
    captureFps: 30,
    inferenceFps: 12,
    source: { kind: 'camera', label: 'FaceTime HD', width: 1280, height: 720 },
    models: { detector: null, pose2d: 'rtmpose-m', lift3d: null },
    files: { video: 'video.webm', keypoints: 'raw-keypoints.bin', thumbnail: null },
    twistEstimatedJoints: [],
  };
  await manager.finalizeTake(manifest);
  return { projectId: project.id, takeId };
}

beforeEach(async () => {
  // Same harness the Document 2 manager tests use: a real provider over an
  // in-memory OPFS, so path handling and delete semantics are genuinely tested.
  const root = new MemoryDirectoryHandle('ws');
  vi.stubGlobal('navigator', {
    storage: { getDirectory: async () => root, estimate: async () => ({ usage: 0 }) },
  });
  const opfs = new OpfsWorkspaceProvider();
  await opfs.requestAccess();
  provider = opfs;
  manager = new WorkspaceManager(provider);
  await manager.initialize();
});

describe('project lifecycle', () => {
  it('creates, lists, renames and deletes a project', async () => {
    const project = await manager.createProject('My Project');
    expect(await manager.listProjectIds()).toContain(project.id);

    const renamed = await manager.renameProject(project.id, 'Renamed');
    expect(renamed.name).toBe('Renamed');
    // The rename must survive a re-read, not just mutate the returned object.
    expect((await manager.readProject(project.id)).name).toBe('Renamed');

    await manager.deleteProject(project.id);
    expect(await manager.listProjectIds()).not.toContain(project.id);
  });

  it('keeps the folder id stable across a rename', async () => {
    const project = await manager.createProject('Original Name');
    const originalId = project.id;
    await manager.renameProject(project.id, 'Completely Different');

    // Renaming must not move data: the id is the storage key on every tier.
    expect(await manager.listProjectIds()).toEqual([originalId]);
    expect((await manager.readProject(originalId)).id).toBe(originalId);
  });

  it('deleting a project removes its takes too', async () => {
    const { projectId, takeId } = await seedTake();
    expect(await manager.listTakeIds(projectId)).toContain(takeId);

    await manager.deleteProject(projectId);
    expect(await provider.exists(`projects/${projectId}`)).toBe(false);
  });
});

describe('take lifecycle', () => {
  it('renames a take without moving it', async () => {
    const { projectId, takeId } = await seedTake();

    const renamed = await manager.renameTake(projectId, takeId, 'Best Take');
    expect(renamed.name).toBe('Best Take');
    expect(renamed.id).toBe(takeId);
    expect((await manager.readTake(projectId, takeId)).name).toBe('Best Take');
    expect(await manager.listTakeIds(projectId)).toEqual([takeId]);
  });

  it('defaults settings for a Document 2 take that has none', async () => {
    const { projectId, takeId } = await seedTake();
    const settings = await manager.readTakeSettings(projectId, takeId);

    expect(settings.subjectHeightMeters).toBeNull();
    expect(settings.refine).toEqual(REFINE_DEFAULTS);
  });

  it('persists settings across a re-read', async () => {
    const { projectId, takeId } = await seedTake();
    const settings = withTakeSettingsDefaults({ subjectHeightMeters: 1.78 });
    settings.refine.maxGapFrames = 20;

    await manager.updateTakeSettings(projectId, takeId, settings);
    const reread = await manager.readTakeSettings(projectId, takeId);

    expect(reread.subjectHeightMeters).toBe(1.78);
    expect(reread.refine.maxGapFrames).toBe(20);
  });

  it('does not clobber unrelated manifest fields when updating settings', async () => {
    const { projectId, takeId } = await seedTake();
    await manager.updateTakeSettings(
      projectId,
      takeId,
      withTakeSettingsDefaults({ subjectHeightMeters: 1.7 }),
    );

    const manifest = await manager.readTake(projectId, takeId);
    expect(manifest.frameCount).toBe(300);
    expect(manifest.source.label).toBe('FaceTime HD');
    expect(manifest.files.keypoints).toBe('raw-keypoints.bin');
  });
});

describe('refined-track writes (§8.3 atomicity)', () => {
  it('reports no refined data before a refine pass', async () => {
    const { projectId, takeId } = await seedTake();
    expect(await manager.hasRefined(projectId, takeId)).toBe(false);
    await expect(manager.readTakeRefined(projectId, takeId)).rejects.toThrow(/No refined data/);
  });

  it('writes refined data and advertises it in the manifest', async () => {
    const { projectId, takeId } = await seedTake();
    const payload = new Uint8Array([1, 2, 3, 4, 5]);

    const manifest = await manager.writeTakeRefined(projectId, takeId, payload);

    expect(manifest.files.refined).toBe('refined.bin');
    expect(manifest.refinedAt).toBeTruthy();
    expect(await manager.hasRefined(projectId, takeId)).toBe(true);
    expect(Array.from(await manager.readTakeRefined(projectId, takeId))).toEqual([1, 2, 3, 4, 5]);
  });

  it('leaves no .tmp file behind after a successful write', async () => {
    const { projectId, takeId } = await seedTake();
    await manager.writeTakeRefined(projectId, takeId, new Uint8Array([9]));

    expect(await provider.exists(takeRefinedTmpPath(projectId, takeId))).toBe(false);
    expect(await provider.exists(takeRefinedPath(projectId, takeId))).toBe(true);
  });

  it('never touches the raw keypoints or video', async () => {
    const { projectId, takeId } = await seedTake();
    await provider.writeFile(
      `projects/${projectId}/takes/${takeId}/raw-keypoints.bin`,
      new Uint8Array([42, 42, 42]),
    );
    const before = await manager.readTakeKeypoints(projectId, takeId);

    await manager.writeTakeRefined(projectId, takeId, new Uint8Array([7, 7]));

    // The core guarantee of the whole refine pass: raw is immutable.
    expect(Array.from(await manager.readTakeKeypoints(projectId, takeId))).toEqual(
      Array.from(before),
    );
  });

  it('cleans up a stranded .tmp from a cancelled run', async () => {
    const { projectId, takeId } = await seedTake();
    await provider.writeFile(takeRefinedTmpPath(projectId, takeId), new Uint8Array([1, 2]));

    await manager.cleanupRefineTemp(projectId, takeId);

    expect(await provider.exists(takeRefinedTmpPath(projectId, takeId))).toBe(false);
    // Cleanup must not invent a refined.bin out of the partial file.
    expect(await manager.hasRefined(projectId, takeId)).toBe(false);
  });

  it('cleanup is safe when there is nothing to clean', async () => {
    const { projectId, takeId } = await seedTake();
    await expect(manager.cleanupRefineTemp(projectId, takeId)).resolves.toBeUndefined();
  });

  it('a manifest written before promotion never references refined.bin', async () => {
    const { projectId, takeId } = await seedTake();
    // Simulate a crash after the tmp write but before promotion.
    await provider.writeFile(takeRefinedTmpPath(projectId, takeId), new Uint8Array([1, 2, 3]));

    const manifest = await manager.readTake(projectId, takeId);
    expect(manifest.files.refined ?? null).toBeNull();
    expect(await manager.hasRefined(projectId, takeId)).toBe(false);
  });
});
