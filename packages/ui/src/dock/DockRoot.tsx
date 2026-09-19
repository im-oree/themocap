/**
 * The docking surface: a thin, themed wrapper over `DockviewReact`.
 *
 * Responsibilities kept here (and nowhere else):
 *   - applying the `.wms-dock` reskin class,
 *   - adapting our `PanelRegistry` to dockview's `components` map,
 *   - restoring a saved layout or building the default one,
 *   - debounced layout persistence,
 *   - a themed watermark for the empty state.
 *
 * Deliberately NOT here: any knowledge of what a Viewport or a Timeline is. The
 * app registers those; this component stays reusable and independently testable.
 */

import { useCallback, useEffect, useMemo, useRef } from 'react';
import { DockviewReact, type DockviewApi, type DockviewReadyEvent, type IDockviewPanelProps } from 'dockview-react';

import { cn } from '../cn';
import { applyDefaultLayout, type ApplyDefaultLayoutOptions } from './defaultLayout';
import {
  debounceLayoutSave,
  type LayoutStore,
  type SerializedLayout,
} from './layoutPersistence';
import type { DockPanelComponentProps, PanelRegistry } from './panelRegistry';

export interface DockRootProps<Id extends string> {
  registry: PanelRegistry<Id>;
  /** Workspace tab this dock belongs to; layouts are saved per tab. */
  tabId: string;
  layoutStore: LayoutStore;
  onApiReady?: (api: DockviewApi) => void;
  layoutOptions?: ApplyDefaultLayoutOptions;
  className?: string;
  /** Milliseconds to debounce layout writes. */
  saveDebounceMs?: number;
}

export function DockRoot<Id extends string>({
  registry,
  tabId,
  layoutStore,
  onApiReady,
  layoutOptions,
  className,
  saveDebounceMs = 500,
}: DockRootProps<Id>) {
  const apiRef = useRef<DockviewApi | null>(null);
  // Held in a ref so a re-render never swaps the debouncer mid-drag.
  const saverRef = useRef<ReturnType<typeof debounceLayoutSave> | null>(null);

  /**
   * Adapt registry components to dockview's prop shape.
   *
   * Memoised on the registry: dockview treats a new `components` object as a
   * reason to recreate panels, which for the Viewport means destroying and
   * rebuilding a WebGL context (§B.1.4 explicitly warns about this).
   */
  const components = useMemo(() => {
    const map: Record<string, React.FunctionComponent<IDockviewPanelProps>> = {};
    for (const descriptor of registry.list()) {
      const Component = descriptor.component as React.ComponentType<DockPanelComponentProps>;
      const Wrapped: React.FunctionComponent<IDockviewPanelProps> = (props) => (
        <Component
          panelId={props.api.id}
          params={props.params as Record<string, unknown> | undefined}
        />
      );
      Wrapped.displayName = `DockPanel(${descriptor.id})`;
      map[descriptor.id] = Wrapped;
    }
    return map;
  }, [registry]);

  const onReady = useCallback(
    (event: DockviewReadyEvent) => {
      const api = event.api;
      apiRef.current = api;

      const saver = debounceLayoutSave((layout) => {
        void layoutStore.save(tabId, layout);
      }, saveDebounceMs);
      saverRef.current = saver;

      // Restore asynchronously; the dock renders empty for a frame, which the
      // watermark covers.
      void (async () => {
        let restored = false;
        try {
          const saved = await layoutStore.load(tabId);
          if (saved) {
            api.fromJSON(saved as never);
            restored = true;
          }
        } catch {
          // A layout that dockview refuses must never brick the shell — fall
          // through to the default arrangement instead.
          restored = false;
        }

        if (!restored) {
          try {
            api.clear();
          } catch {
            /* nothing to clear */
          }
          applyDefaultLayout(api, registry, layoutOptions);
        }

        // Subscribe only after restore, so replaying a saved layout does not
        // immediately rewrite it.
        api.onDidLayoutChange(() => {
          saver.schedule(api.toJSON() as unknown as SerializedLayout);
        });

        onApiReady?.(api);
      })();
    },
    [layoutStore, tabId, saveDebounceMs, registry, layoutOptions, onApiReady],
  );

  // Flush a pending layout write when the tab is hidden or closed, so an
  // arrangement changed seconds before a reload is not lost to the debounce.
  useEffect(() => {
    const flush = () => saverRef.current?.flush();
    window.addEventListener('pagehide', flush);
    document.addEventListener('visibilitychange', flush);
    return () => {
      window.removeEventListener('pagehide', flush);
      document.removeEventListener('visibilitychange', flush);
      flush();
    };
  }, []);

  return (
    <DockviewReact
      className={cn('wms-dock h-full w-full', className)}
      components={components}
      onReady={onReady}
      watermarkComponent={DockWatermark}
      singleTabMode="fullwidth"
      disableFloatingGroups={false}
    />
  );
}

/** Shown when every panel in a group has been closed. */
function DockWatermark() {
  return (
    <div className="flex h-full w-full items-center justify-center bg-surface-light p-6 text-center dark:bg-surface-dark">
      <div className="max-w-xs">
        <p className="text-[13px] font-medium text-content-light-primary dark:text-content-dark-primary">
          No panels open here
        </p>
        <p className="mt-1 text-[12px] leading-relaxed text-content-light-secondary dark:text-content-dark-secondary">
          Reopen one from the <span className="font-medium">Panels</span> menu, or drag a panel tab
          into this area.
        </p>
      </div>
    </div>
  );
}
