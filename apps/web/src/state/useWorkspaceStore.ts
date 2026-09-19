/**
 * Workspace selection state for the UI layer.
 *
 * Wraps the Document 2 storage abstraction (`selectProvider`, `WorkspaceManager`)
 * with the bits React needs: which tier is active, whether it is ready, and the
 * project/take tree currently on disk.
 *
 * The provider override is persisted in `localStorage` because it must be known
 * before any storage is available — it is the setting that *decides* which
 * storage to use, so it cannot live in the storage it selects.
 */

import { create } from 'zustand';

import { WorkspaceManager } from '../features/workspace/WorkspaceManager';
import {
  describeSelection,
  detectWorkspaceCapabilities,
  selectProvider,
} from '../features/workspace/selectProvider';
import type {
  WorkspaceCapabilities,
  WorkspaceProvider,
  WorkspaceProviderId,
} from '../features/workspace/types';

const OVERRIDE_KEY = 'wms-workspace-provider';

function readOverride(): WorkspaceProviderId | null {
  try {
    const value = localStorage.getItem(OVERRIDE_KEY);
    return value === 'fsa' || value === 'opfs' || value === 'idb-fallback' ? value : null;
  } catch {
    return null;
  }
}

function writeOverride(id: WorkspaceProviderId | null): void {
  try {
    if (id) localStorage.setItem(OVERRIDE_KEY, id);
    else localStorage.removeItem(OVERRIDE_KEY);
  } catch {
    /* private mode: the override simply will not persist */
  }
}

export interface TakeNode {
  id: string;
  name: string;
}

export interface ProjectNode {
  id: string;
  name: string;
  takes: TakeNode[];
}

interface WorkspaceState {
  capabilities: WorkspaceCapabilities;
  providerId: WorkspaceProviderId | null;
  provider: WorkspaceProvider | null;
  manager: WorkspaceManager | null;
  /** True once the provider has a usable root. `fsa` needs a folder pick first. */
  ready: boolean;
  /** User-facing explanation of the active tier, for the badge tooltip. */
  description: string;
  busy: boolean;
  error: string | null;

  projects: ProjectNode[];

  /** Detects capabilities and picks a tier without requesting access. */
  init: () => void;
  /** Activates a tier. For `fsa` this MUST be called from a user gesture. */
  choose: (id: WorkspaceProviderId) => Promise<void>;
  refresh: () => Promise<void>;
  createProject: (name: string) => Promise<void>;
  deleteTake: (projectId: string, takeId: string) => Promise<void>;
}

export const useWorkspaceStore = create<WorkspaceState>((set, get) => ({
  capabilities: { available: [], preferred: 'idb-fallback', requiresUserGesture: false },
  providerId: null,
  provider: null,
  manager: null,
  ready: false,
  description: '',
  busy: false,
  error: null,
  projects: [],

  init: () => {
    const capabilities = detectWorkspaceCapabilities();
    const selection = selectProvider(readOverride());
    set({
      capabilities,
      providerId: selection.id,
      description: describeSelection(selection),
      // `fsa` is selected but not ready: the picker has not run yet.
      ready: false,
      provider: null,
      manager: null,
    });
  },

  choose: async (id) => {
    set({ busy: true, error: null });
    try {
      const selection = selectProvider(id);
      await selection.provider.requestAccess();
      const manager = new WorkspaceManager(selection.provider);
      await manager.initialize();
      writeOverride(id);
      set({
        providerId: selection.id,
        provider: selection.provider,
        manager,
        ready: true,
        description: describeSelection(selection),
        busy: false,
      });
      await get().refresh();
    } catch (error) {
      set({
        busy: false,
        // A cancelled folder picker is a normal outcome, not a failure to shout
        // about, but the user still needs to know nothing was selected.
        error: error instanceof Error ? error.message : String(error),
      });
    }
  },

  refresh: async () => {
    const manager = get().manager;
    if (!manager) return;
    try {
      const projectIds = await manager.listProjectIds();
      const projects: ProjectNode[] = [];
      for (const id of projectIds) {
        const takeIds = await manager.listTakeIds(id);
        let name = id;
        try {
          name = (await manager.readProject(id)).name;
        } catch {
          // A project folder with no readable manifest still lists, under its
          // folder name — better than hiding the user's data.
        }
        projects.push({ id, name, takes: takeIds.map((takeId) => ({ id: takeId, name: takeId })) });
      }
      set({ projects });
    } catch (error) {
      set({ error: error instanceof Error ? error.message : String(error) });
    }
  },

  createProject: async (name) => {
    const manager = get().manager;
    if (!manager) return;
    await manager.createProject(name);
    await get().refresh();
  },

  deleteTake: async (projectId, takeId) => {
    const manager = get().manager;
    if (!manager) return;
    await manager.deleteTake(projectId, takeId);
    await get().refresh();
  },
}));
