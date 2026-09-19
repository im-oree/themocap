/**
 * Editor shell state: workspace tabs, viewport display toggles, and the
 * Properties panel's context.
 *
 * Kept separate from `useAppStore` (theme, offline readiness, dev flags) because
 * this is per-session editor UI state, whereas that is application state. They
 * have different lifetimes and different persistence rules.
 */

import { create } from 'zustand';

/** Top-level workspace tabs (§A.8). 'edit' is registered but inert until Doc 4. */
export type WorkspaceTabId = 'live' | 'edit';

/** What the Properties panel is currently showing (§B.5). */
export type PropertiesContext =
  | { kind: 'session' }
  | { kind: 'export' }
  | { kind: 'preferences' }
  | { kind: 'joint'; jointName: string };

/** Viewport display toggles, driven by the in-viewport overlay toolbar (§B.1.3). */
export interface ViewportToggles {
  grid: boolean;
  worldAxes: boolean;
  navGizmo: boolean;
  skeleton: boolean;
  capsuleBody: boolean;
  /** Stub until Document 4's onion-skin work; control is present but inert. */
  jointTrails: boolean;
  cameraFrustum: boolean;
  stats: boolean;
}

export type ViewportToggleKey = keyof ViewportToggles;

/** Camera navigation mode (§B.1.1). */
export type CameraMode = 'orbit' | 'fly';

export interface OneEuroParams {
  minCutoff: number;
  beta: number;
  dCutoff: number;
}

/** Defaults from Document 2 §10, mirrored in Rust's filter/multi_joint.rs. */
export const ONE_EURO_DEFAULTS: OneEuroParams = {
  minCutoff: 1.0,
  beta: 0.007,
  dCutoff: 1.0,
};

interface EditorState {
  activeTab: WorkspaceTabId;
  setActiveTab: (tab: WorkspaceTabId) => void;

  propertiesContext: PropertiesContext;
  setPropertiesContext: (context: PropertiesContext) => void;

  viewport: ViewportToggles;
  toggleViewport: (key: ViewportToggleKey) => void;
  setViewportToggle: (key: ViewportToggleKey, value: boolean) => void;

  cameraMode: CameraMode;
  setCameraMode: (mode: CameraMode) => void;

  /**
   * Incremented to ask the Viewport to run a one-shot camera command. A counter
   * rather than a boolean so two identical requests in a row both fire.
   */
  cameraCommand: { action: 'reset' | 'frameAll' | 'frameSelected' | null; nonce: number };
  requestCamera: (action: 'reset' | 'frameAll' | 'frameSelected') => void;

  filterParams: OneEuroParams;
  setFilterParam: (key: keyof OneEuroParams, value: number) => void;
  resetFilterParams: () => void;

  /** Subject height in metres, collected now for Document 3's scaling step. */
  subjectHeight: number;
  setSubjectHeight: (metres: number) => void;
}

export const useEditorStore = create<EditorState>((set) => ({
  activeTab: 'live',
  setActiveTab: (activeTab) => set({ activeTab }),

  propertiesContext: { kind: 'session' },
  setPropertiesContext: (propertiesContext) => set({ propertiesContext }),

  viewport: {
    grid: true,
    worldAxes: true,
    navGizmo: true,
    skeleton: true,
    capsuleBody: true,
    jointTrails: false,
    cameraFrustum: false,
    stats: true,
  },
  toggleViewport: (key) =>
    set((state) => ({ viewport: { ...state.viewport, [key]: !state.viewport[key] } })),
  setViewportToggle: (key, value) =>
    set((state) => ({ viewport: { ...state.viewport, [key]: value } })),

  cameraMode: 'orbit',
  setCameraMode: (cameraMode) => set({ cameraMode }),

  cameraCommand: { action: null, nonce: 0 },
  requestCamera: (action) =>
    set((state) => ({ cameraCommand: { action, nonce: state.cameraCommand.nonce + 1 } })),

  filterParams: { ...ONE_EURO_DEFAULTS },
  setFilterParam: (key, value) =>
    set((state) => ({ filterParams: { ...state.filterParams, [key]: value } })),
  resetFilterParams: () => set({ filterParams: { ...ONE_EURO_DEFAULTS } }),

  subjectHeight: 1.75,
  setSubjectHeight: (subjectHeight) => set({ subjectHeight }),
}));
