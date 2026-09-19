/**
 * Project/take tree and the currently open take (Document 3 §6.1).
 *
 * Every mutation goes through `WorkspaceManager`, never a storage API directly —
 * that is what keeps the three provider tiers interchangeable.
 *
 * This store owns *metadata and selection*. The actual pose payload for an open
 * take lives in `useLoadedTake`, because it is large, and mixing megabyte typed
 * arrays into a store that re-renders a tree would be a performance trap.
 */

import { create } from 'zustand';
import { withTakeSettingsDefaults, type TakeSettings } from '@wms/take-model';

import type { WorkspaceManager } from '../features/workspace/WorkspaceManager';
import type { TakeManifest } from '../features/workspace/layout';

export interface TakeSummary {
  id: string;
  name: string;
  createdAt: number;
  durationSec: number;
  frameCount: number;
  hasRefined: boolean;
  /** Problems found by `validateTake`. Non-empty means "listed but damaged". */
  problems: string[];
}

export interface ProjectNode {
  id: string;
  name: string;
  takes: TakeSummary[];
}

interface TakeStoreState {
  projects: ProjectNode[];
  activeProjectId: string | null;
  activeTakeId: string | null;
  /** Manifest of the active take, or null when nothing is open. */
  activeTake: TakeManifest | null;
  activeSettings: TakeSettings | null;
  loading: boolean;
  error: string | null;

  loadProjects: (manager: WorkspaceManager) => Promise<void>;
  createProject: (manager: WorkspaceManager, name: string) => Promise<void>;
  renameProject: (manager: WorkspaceManager, id: string, name: string) => Promise<void>;
  deleteProject: (manager: WorkspaceManager, id: string) => Promise<void>;
  renameTake: (
    manager: WorkspaceManager,
    projectId: string,
    takeId: string,
    name: string,
  ) => Promise<void>;
  deleteTake: (manager: WorkspaceManager, projectId: string, takeId: string) => Promise<void>;
  selectTake: (
    manager: WorkspaceManager,
    projectId: string,
    takeId: string,
  ) => Promise<TakeManifest | null>;
  clearSelection: () => void;
  updateSettings: (manager: WorkspaceManager, settings: TakeSettings) => Promise<void>;
  /** Called by the refine pipeline once it has written `refined.bin`. */
  markRefined: (projectId: string, takeId: string) => void;
}

function toMillis(iso: string): number {
  const value = Date.parse(iso);
  return Number.isNaN(value) ? 0 : value;
}

export const useTakeStore = create<TakeStoreState>((set, get) => ({
  projects: [],
  activeProjectId: null,
  activeTakeId: null,
  activeTake: null,
  activeSettings: null,
  loading: false,
  error: null,

  loadProjects: async (manager) => {
    set({ loading: true, error: null });
    try {
      const projectIds = await manager.listProjectIds();
      const projects: ProjectNode[] = [];

      for (const projectId of projectIds) {
        let name = projectId;
        try {
          name = (await manager.readProject(projectId)).name;
        } catch {
          // A project folder with an unreadable manifest is still listed under
          // its folder name. Hiding the user's data because one JSON file is
          // corrupt would be much worse than showing it with a fallback label.
        }

        const takeIds = await manager.listTakeIds(projectId);
        const takes: TakeSummary[] = [];
        for (const takeId of takeIds) {
          try {
            const manifest = await manager.readTake(projectId, takeId);
            takes.push({
              id: takeId,
              name: manifest.name || takeId,
              createdAt: toMillis(manifest.createdAt),
              durationSec: manifest.durationSeconds,
              frameCount: manifest.frameCount,
              hasRefined: Boolean(manifest.files.refined),
              problems: [],
            });
          } catch (cause) {
            takes.push({
              id: takeId,
              name: takeId,
              createdAt: 0,
              durationSec: 0,
              frameCount: 0,
              hasRefined: false,
              problems: [`Unreadable take.json: ${String(cause)}`],
            });
          }
        }

        projects.push({ id: projectId, name, takes });
      }

      set({ projects, loading: false });
    } catch (cause) {
      set({ loading: false, error: cause instanceof Error ? cause.message : String(cause) });
    }
  },

  createProject: async (manager, name) => {
    await manager.createProject(name);
    await get().loadProjects(manager);
  },

  renameProject: async (manager, id, name) => {
    await manager.renameProject(id, name);
    await get().loadProjects(manager);
  },

  deleteProject: async (manager, id) => {
    await manager.deleteProject(id);
    if (get().activeProjectId === id) get().clearSelection();
    await get().loadProjects(manager);
  },

  renameTake: async (manager, projectId, takeId, name) => {
    const manifest = await manager.renameTake(projectId, takeId, name);
    // Keep the open take's manifest in step so the Properties panel does not
    // keep showing the old name until the next tree reload.
    if (get().activeTakeId === takeId) set({ activeTake: manifest });
    await get().loadProjects(manager);
  },

  deleteTake: async (manager, projectId, takeId) => {
    await manager.deleteTake(projectId, takeId);
    if (get().activeTakeId === takeId) get().clearSelection();
    await get().loadProjects(manager);
  },

  selectTake: async (manager, projectId, takeId) => {
    set({ loading: true, error: null });
    try {
      const manifest = await manager.readTake(projectId, takeId);
      set({
        activeProjectId: projectId,
        activeTakeId: takeId,
        activeTake: manifest,
        activeSettings: withTakeSettingsDefaults(manifest.settings),
        loading: false,
      });
      return manifest;
    } catch (cause) {
      set({ loading: false, error: cause instanceof Error ? cause.message : String(cause) });
      return null;
    }
  },

  clearSelection: () =>
    set({
      activeProjectId: null,
      activeTakeId: null,
      activeTake: null,
      activeSettings: null,
    }),

  updateSettings: async (manager, settings) => {
    const { activeProjectId, activeTakeId } = get();
    if (!activeProjectId || !activeTakeId) return;
    // Optimistic: the sliders must not lag a disk write.
    set({ activeSettings: settings });
    const manifest = await manager.updateTakeSettings(activeProjectId, activeTakeId, settings);
    set({ activeTake: manifest });
  },

  markRefined: (projectId, takeId) =>
    set((state) => ({
      projects: state.projects.map((project) =>
        project.id === projectId
          ? {
              ...project,
              takes: project.takes.map((take) =>
                take.id === takeId ? { ...take, hasRefined: true } : take,
              ),
            }
          : project,
      ),
    })),
}));
