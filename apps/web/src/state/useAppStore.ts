import { create } from 'zustand';

export type SectionId = 'live' | 'takes' | 'editor' | 'export' | 'settings';

/** Readiness of the local model cache. Real logic lands in Document 3/6. */
export type OfflineReadiness = 'unknown' | 'ready' | 'incomplete';

interface AppState {
  sidebarCollapsed: boolean;
  toggleSidebar: () => void;
  setSidebarCollapsed: (collapsed: boolean) => void;

  activeSection: SectionId;
  setActiveSection: (id: SectionId) => void;

  offlineReadiness: OfflineReadiness;
  setOfflineReadiness: (r: OfflineReadiness) => void;

  /** Dev-only flags surfaced in the diagnostics panel. */
  devFlags: {
    strictOffline: boolean;
    serviceWorker: boolean;
  };
}

const SIDEBAR_KEY = 'wms-sidebar-collapsed';

function readCollapsed(): boolean {
  if (typeof localStorage === 'undefined') return false;
  return localStorage.getItem(SIDEBAR_KEY) === '1';
}

function persistCollapsed(collapsed: boolean): void {
  if (typeof localStorage === 'undefined') return;
  localStorage.setItem(SIDEBAR_KEY, collapsed ? '1' : '0');
}

export const useAppStore = create<AppState>((set, get) => ({
  sidebarCollapsed: readCollapsed(),
  toggleSidebar: () => {
    const next = !get().sidebarCollapsed;
    persistCollapsed(next);
    set({ sidebarCollapsed: next });
  },
  setSidebarCollapsed: (collapsed) => {
    persistCollapsed(collapsed);
    set({ sidebarCollapsed: collapsed });
  },

  activeSection: 'live',
  setActiveSection: (id) => set({ activeSection: id }),

  offlineReadiness: 'unknown',
  setOfflineReadiness: (offlineReadiness) => set({ offlineReadiness }),

  devFlags: {
    strictOffline: import.meta.env?.VITE_STRICT_OFFLINE === '1',
    serviceWorker: import.meta.env?.VITE_ENABLE_SW === '1',
  },
}));
