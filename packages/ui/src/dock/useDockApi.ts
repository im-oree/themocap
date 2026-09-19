/**
 * Typed, React-friendly facade over dockview's imperative API.
 *
 * Two problems this solves:
 *
 * 1. **Panel ids are stringly-typed in dockview.** Here they are the registry's
 *    union type, so a typo in a menu action is a compile error rather than a
 *    silent no-op.
 * 2. **Open/closed state is not reactive.** The Panels menu needs checkboxes
 *    that track reality (§A.9 item 4), but dockview exposes panels via imperative
 *    getters. This hook subscribes to add/remove events and mirrors the set of
 *    open ids into React state.
 */

import { useCallback, useEffect, useState } from 'react';
import type { DockviewApi } from 'dockview-react';

import { applyDefaultLayout, openPanelAtDefaultLocation } from './defaultLayout';
import type { LayoutStore } from './layoutPersistence';
import type { PanelRegistry } from './panelRegistry';

export interface DockController<Id extends string> {
  /** Ids currently open, kept in sync with the dock. */
  openPanels: Set<Id>;
  isOpen: (id: Id) => boolean;
  open: (id: Id) => void;
  close: (id: Id) => void;
  toggle: (id: Id) => void;
  focus: (id: Id) => void;
  resetLayout: () => void;
  ready: boolean;
}

export function useDockApi<Id extends string>(
  api: DockviewApi | null,
  registry: PanelRegistry<Id>,
  layoutStore: LayoutStore,
  tabId: string,
): DockController<Id> {
  const [openPanels, setOpenPanels] = useState<Set<Id>>(() => new Set());

  // Mirror dockview's panel set into React state.
  useEffect(() => {
    if (!api) return;

    const sync = () => setOpenPanels(new Set(api.panels.map((panel) => panel.id as Id)));
    sync();

    const added = api.onDidAddPanel(sync);
    const removed = api.onDidRemovePanel(sync);
    // A layout restore replaces every panel at once without necessarily firing
    // per-panel events in every dockview version, so re-sync on layout change too.
    const layout = api.onDidLayoutChange(sync);

    return () => {
      added.dispose();
      removed.dispose();
      layout.dispose();
    };
  }, [api]);

  const open = useCallback(
    (id: Id) => {
      if (!api) return;
      openPanelAtDefaultLocation(api, registry, id);
    },
    [api, registry],
  );

  const close = useCallback(
    (id: Id) => {
      const panel = api?.getPanel(id);
      if (panel) api?.removePanel(panel);
    },
    [api],
  );

  const toggle = useCallback(
    (id: Id) => {
      if (!api) return;
      if (api.getPanel(id)) close(id);
      else open(id);
    },
    [api, close, open],
  );

  const focus = useCallback(
    (id: Id) => {
      const panel = api?.getPanel(id);
      if (panel) panel.api.setActive();
      else open(id);
    },
    [api, open],
  );

  const resetLayout = useCallback(() => {
    if (!api) return;
    // Clear persisted state first: if applying the default throws halfway, the
    // next reload should still come up with a clean default rather than the
    // half-applied layout we just saved over it.
    void layoutStore.clear(tabId);
    applyDefaultLayout(api, registry);
  }, [api, registry, layoutStore, tabId]);

  return {
    openPanels,
    isOpen: useCallback((id: Id) => openPanels.has(id), [openPanels]),
    open,
    close,
    toggle,
    focus,
    resetLayout,
    ready: api !== null,
  };
}
