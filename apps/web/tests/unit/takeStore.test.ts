/**
 * Document 3 §6.1: the take store drives everything through WorkspaceManager.
 *
 * Runs against a real manager over an in-memory OPFS, so these assertions cover
 * the store *and* its interaction with storage — the interesting bugs live in
 * that seam (stale trees after a mutation, selection surviving a delete).
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { withTakeSettingsDefaults } from '@wms/take-model';

import { WorkspaceManager } from '../../src/features/workspace/WorkspaceManager';
import { OpfsWorkspaceProvider } from '../../src/features/workspace/providers/opfsProvider';
import { useTakeStore } from '../../src/state/useTakeStore';
import type { TakeManifest } from '../../src/features/workspace/layout';
import { MemoryDirectoryHandle } from './memoryFileSystem';

let manager: WorkspaceManager;

async function addTake(projectId: string, name: string) {
  const takeId = await manager.createTake({ projectId, name });
  const manifest: TakeManifest = {
    version: 1,
    id: takeId,
    name,
    projectId,
    createdAt: new Date().toISOString(),
    durationSeconds: 5,
    frameCount: 150,
    captureFps: 30,
    inferenceFps: 14,
    source: { kind: 'camera', label: 'cam', width: 640, height: 480 },
    models: { detector: null, pose2d: null, lift3d: null },
    files: { video: null, keypoints: 'raw-keypoints.bin', thumbnail: null },
    twistEstimatedJoints: [],
  };
  await manager.finalizeTake(manifest);
  return takeId;
}

const store = () => useTakeStore.getState();

beforeEach(async () => {
  const root = new MemoryDirectoryHandle('ws');
  vi.stubGlobal('navigator', {
    storage: { getDirectory: async () => root, estimate: async () => ({ usage: 0 }) },
  });
  const provider = new OpfsWorkspaceProvider();
  await provider.requestAccess();
  manager = new WorkspaceManager(provider);
  await manager.initialize();

  useTakeStore.setState({
    projects: [],
    activeProjectId: null,
    activeTakeId: null,
    activeTake: null,
    activeSettings: null,
    loading: false,
    error: null,
  });
});

describe('loadProjects', () => {
  it('builds the workspace tree', async () => {
    const project = await manager.createProject('Demo');
    await addTake(project.id, 'Take A');
    await addTake(project.id, 'Take B');

    await store().loadProjects(manager);

    const projects = store().projects;
    expect(projects).toHaveLength(1);
    expect(projects[0]!.name).toBe('Demo');
    expect(projects[0]!.takes.map((t) => t.name)).toEqual(['Take A', 'Take B']);
    expect(projects[0]!.takes[0]!.durationSec).toBe(5);
    expect(projects[0]!.takes[0]!.hasRefined).toBe(false);
  });

  it('reports an empty workspace without error', async () => {
    await store().loadProjects(manager);
    expect(store().projects).toEqual([]);
    expect(store().error).toBeNull();
  });

  it('still lists a take whose manifest is corrupt, flagged as damaged', async () => {
    const project = await manager.createProject('Demo');
    const takeId = await addTake(project.id, 'Broken');
    // Corrupt the manifest behind the manager's back.
    const provider = (manager as unknown as { provider: OpfsWorkspaceProvider }).provider;
    await provider.writeText(`projects/${project.id}/takes/${takeId}/take.json`, '{ not json');

    await store().loadProjects(manager);

    const take = store().projects[0]!.takes[0]!;
    // Losing sight of the user's recording because one file is malformed would
    // be far worse than showing it with a warning.
    expect(take.id).toBe(takeId);
    expect(take.problems.length).toBeGreaterThan(0);
  });

  it('marks a refined take with hasRefined', async () => {
    const project = await manager.createProject('Demo');
    const takeId = await addTake(project.id, 'Refined');
    await manager.writeTakeRefined(project.id, takeId, new Uint8Array([1, 2, 3]));

    await store().loadProjects(manager);
    expect(store().projects[0]!.takes[0]!.hasRefined).toBe(true);
  });
});

describe('mutations refresh the tree', () => {
  it('createProject appears without a manual reload', async () => {
    await store().createProject(manager, 'Fresh');
    expect(store().projects.map((p) => p.name)).toEqual(['Fresh']);
  });

  it('renameProject updates the displayed name but not the id', async () => {
    await store().createProject(manager, 'Before');
    const id = store().projects[0]!.id;

    await store().renameProject(manager, id, 'After');

    expect(store().projects[0]!.name).toBe('After');
    expect(store().projects[0]!.id).toBe(id);
  });

  it('renameTake updates the tree and the open take together', async () => {
    const project = await manager.createProject('Demo');
    const takeId = await addTake(project.id, 'Old Name');
    await store().selectTake(manager, project.id, takeId);

    await store().renameTake(manager, project.id, takeId, 'New Name');

    expect(store().projects[0]!.takes[0]!.name).toBe('New Name');
    // The Properties panel reads activeTake; it must not lag the tree.
    expect(store().activeTake!.name).toBe('New Name');
  });

  it('deleteTake clears the selection when the open take is deleted', async () => {
    const project = await manager.createProject('Demo');
    const takeId = await addTake(project.id, 'Doomed');
    await store().selectTake(manager, project.id, takeId);
    expect(store().activeTakeId).toBe(takeId);

    await store().deleteTake(manager, project.id, takeId);

    expect(store().activeTakeId).toBeNull();
    expect(store().activeTake).toBeNull();
    expect(store().projects[0]!.takes).toEqual([]);
  });

  it('deleteTake keeps the selection when a different take is deleted', async () => {
    const project = await manager.createProject('Demo');
    const keep = await addTake(project.id, 'Keep');
    const drop = await addTake(project.id, 'Drop');
    await store().selectTake(manager, project.id, keep);

    await store().deleteTake(manager, project.id, drop);

    expect(store().activeTakeId).toBe(keep);
  });

  it('deleteProject clears a selection pointing into it', async () => {
    const project = await manager.createProject('Demo');
    const takeId = await addTake(project.id, 'Take');
    await store().selectTake(manager, project.id, takeId);

    await store().deleteProject(manager, project.id);

    expect(store().activeProjectId).toBeNull();
    expect(store().projects).toEqual([]);
  });
});

describe('selection and settings', () => {
  it('selectTake loads the manifest and defaulted settings', async () => {
    const project = await manager.createProject('Demo');
    const takeId = await addTake(project.id, 'Take');

    const manifest = await store().selectTake(manager, project.id, takeId);

    expect(manifest!.id).toBe(takeId);
    expect(store().activeSettings!.subjectHeightMeters).toBeNull();
    expect(store().activeSettings!.refine.maxGapFrames).toBe(12);
  });

  it('records an error instead of throwing for a missing take', async () => {
    const project = await manager.createProject('Demo');
    const result = await store().selectTake(manager, project.id, 'no-such-take');

    expect(result).toBeNull();
    expect(store().error).toBeTruthy();
    expect(store().loading).toBe(false);
  });

  it('updateSettings persists through the manager', async () => {
    const project = await manager.createProject('Demo');
    const takeId = await addTake(project.id, 'Take');
    await store().selectTake(manager, project.id, takeId);

    await store().updateSettings(manager, withTakeSettingsDefaults({ subjectHeightMeters: 1.75 }));

    expect(store().activeSettings!.subjectHeightMeters).toBe(1.75);
    expect((await manager.readTakeSettings(project.id, takeId)).subjectHeightMeters).toBe(1.75);
  });

  it('updateSettings is a no-op with nothing selected', async () => {
    await expect(
      store().updateSettings(manager, withTakeSettingsDefaults({})),
    ).resolves.toBeUndefined();
  });

  it('markRefined flips the badge without a disk round-trip', async () => {
    const project = await manager.createProject('Demo');
    const takeId = await addTake(project.id, 'Take');
    await store().loadProjects(manager);
    expect(store().projects[0]!.takes[0]!.hasRefined).toBe(false);

    store().markRefined(project.id, takeId);

    expect(store().projects[0]!.takes[0]!.hasRefined).toBe(true);
  });
});
