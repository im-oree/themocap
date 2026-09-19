/**
 * The editor shell (§A.1): menu bar, toolbar, dock, status bar.
 *
 * Replaces Document 1's `Shell.tsx`. There is no router and no page: the entire
 * application is this one component and the panels inside the dock.
 *
 * ## Why both tabs stay mounted
 *
 * Each workspace tab gets its own `DockRoot`, and the inactive one is hidden
 * with CSS rather than unmounted. Unmounting would destroy the Viewport's WebGL
 * context and force a full scene rebuild on every tab switch — which is exactly
 * what acceptance criterion 11 and the Playwright `context-lost` spec forbid.
 * Two hidden dock trees cost a few hundred KB of DOM; a lost GL context costs a
 * visible hitch and a rebuilt scene graph.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import type { DockviewApi } from 'dockview-core';
import { DockRoot, LayoutStore, Toaster, cn, useDockApi } from '@wms/ui';

import { createPanelRegistry, type PanelTypeId } from './layoutDefaults';
import { AppMenuBar } from '../shell/MenuBar';
import { AppStatusBar } from '../shell/StatusBar';
import { AppToolbar } from '../shell/Toolbar';
import { useEditorStore, type WorkspaceTabId } from '../state/useEditorStore';
import { useWorkspaceStore } from '../state/useWorkspaceStore';

export function AppDock() {
  // Registry and layout store are created once for the lifetime of the app.
  // A new registry identity would make `DockRoot` rebuild every panel.
  const registry = useMemo(() => createPanelRegistry(), []);
  const layoutStore = useMemo(() => new LayoutStore(), []);

  const activeTab = useEditorStore((s) => s.activeTab);
  const provider = useWorkspaceStore((s) => s.provider);
  const initWorkspace = useWorkspaceStore((s) => s.init);

  const [liveApi, setLiveApi] = useState<DockviewApi | null>(null);

  // Promote layout storage from localStorage to the workspace folder as soon as
  // one is available, so `layout.json` travels with the project (§A.6).
  useEffect(() => {
    void layoutStore.setBackend(provider);
  }, [layoutStore, provider]);

  useEffect(() => {
    initWorkspace();
  }, [initWorkspace]);

  const dock = useDockApi<PanelTypeId>(liveApi, registry, layoutStore, 'live');

  useGlobalShortcuts(dock.ready);

  return (
    <div className="flex h-screen w-screen flex-col overflow-hidden bg-surface-light dark:bg-surface-dark">
      <AppMenuBar dock={dock} />
      <AppToolbar dock={dock} />

      <div className="relative min-h-0 flex-1">
        <TabSurface tabId="live" activeTab={activeTab}>
          <DockRoot<PanelTypeId>
            registry={registry}
            tabId="live"
            layoutStore={layoutStore}
            onApiReady={setLiveApi}
          />
        </TabSurface>

        {/* The Edit tab is disabled in the switcher, so this never shows yet; it
            exists so enabling the tab is a one-line change, not a refactor. */}
        <TabSurface tabId="edit" activeTab={activeTab}>
          <div className="flex h-full items-center justify-center text-[13px] text-content-light-secondary dark:text-content-dark-secondary">
            The Edit workspace arrives in Document 4.
          </div>
        </TabSurface>
      </div>

      <AppStatusBar dock={dock} />
      <Toaster />
    </div>
  );
}

/**
 * Keeps a tab mounted but out of the way.
 *
 * `visibility: hidden` plus zero opacity rather than `display: none`: a
 * `display: none` ancestor gives the canvas a zero-size layout box, and
 * dockview would then restore a layout computed at 0×0 when the tab returns.
 */
function TabSurface({
  tabId,
  activeTab,
  children,
}: {
  tabId: WorkspaceTabId;
  activeTab: WorkspaceTabId;
  children: React.ReactNode;
}) {
  const active = tabId === activeTab;
  return (
    <div
      role="tabpanel"
      aria-hidden={!active}
      data-testid={`workspace-surface-${tabId}`}
      className={cn(
        'absolute inset-0',
        active ? 'visible opacity-100' : 'invisible pointer-events-none opacity-0',
      )}
    >
      {children}
    </div>
  );
}

/**
 * Global keys that must work regardless of which panel has focus.
 *
 * Viewport-local keys (`1`/`3`/`7`/`.`) are handled inside the viewport, since
 * they are meaningless elsewhere and should not steal typing in a text field.
 */
function useGlobalShortcuts(enabled: boolean) {
  const setPropertiesContext = useEditorStore((s) => s.setPropertiesContext);
  const ref = useRef(setPropertiesContext);
  ref.current = setPropertiesContext;

  useEffect(() => {
    if (!enabled) return;
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      // Never hijack keys while the user is typing.
      if (
        target &&
        (target.isContentEditable ||
          ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName))
      ) {
        return;
      }
      const mod = event.metaKey || event.ctrlKey;
      if (mod && event.key === ',') {
        event.preventDefault();
        ref.current({ kind: 'preferences' });
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [enabled]);
}
