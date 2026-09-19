/**
 * Panel registry — the single declarative source of truth for what panels exist.
 *
 * Three things are derived from this one table, which is the point: they can
 * never drift out of sync.
 *
 *   1. The dockview component map (`type` string -> React component).
 *   2. The default layout (from each descriptor's `defaultLocation`).
 *   3. The Panels menu (title, icon, closability, open/closed checkbox state).
 *
 * Adding a panel is therefore a one-line change here plus the component itself.
 *
 * The registry lives in `@wms/ui` but is *populated* by the app, because the
 * panel components belong to the app. `@wms/ui` owns the mechanism; the app owns
 * the content.
 */

import type { ComponentType } from 'react';

/**
 * Where a panel sits in the default arrangement, matching the §A.1 diagram:
 *
 * ```
 * ┌──────────┬────────────────────┬───────────┐
 * │          │   center-top       │           │
 * │   left   ├────────────────────┤   right   │
 * │          │   center-bottom    │           │
 * ├──────────┴────────────────────┴───────────┤
 * │            bottom-full                     │
 * └────────────────────────────────────────────┘
 * ```
 *
 * `float` is for panels that default to closed and open as floating windows
 * (Diagnostics), so they never disturb the main arrangement.
 */
export type PanelLocation =
  | 'left'
  | 'center-top'
  | 'center-bottom'
  | 'right'
  | 'bottom-full'
  | 'float';

export interface DockPanelComponentProps {
  /** Stable id of this panel instance. */
  panelId: string;
  /** Panel-scoped params supplied at open time. */
  params?: Record<string, unknown>;
}

export interface PanelDescriptor<Id extends string = string> {
  id: Id;
  title: string;
  component: ComponentType<DockPanelComponentProps>;
  defaultLocation: PanelLocation;
  /** Whether the user may close it. The Viewport is deliberately not closable. */
  closable: boolean;
  /** Rendered in the Panels menu and the tab strip. */
  icon?: ComponentType<{ className?: string; size?: number | string }>;
  /** Whether it is part of the default layout. Diagnostics defaults to closed. */
  openByDefault: boolean;
  /** Initial size hint in px for the dock region this panel establishes. */
  defaultSize?: number;
  /** Shown in the Panels menu as a secondary line. */
  description?: string;
}

export class PanelRegistry<Id extends string = string> {
  private readonly panels = new Map<Id, PanelDescriptor<Id>>();

  register(descriptor: PanelDescriptor<Id>): this {
    if (this.panels.has(descriptor.id)) {
      throw new Error(`PanelRegistry: duplicate panel id "${descriptor.id}"`);
    }
    this.panels.set(descriptor.id, descriptor);
    return this;
  }

  registerAll(descriptors: PanelDescriptor<Id>[]): this {
    for (const descriptor of descriptors) this.register(descriptor);
    return this;
  }

  get(id: Id): PanelDescriptor<Id> | undefined {
    return this.panels.get(id);
  }

  /** Throws for an unknown id — a typo in a menu action should be loud. */
  require(id: Id): PanelDescriptor<Id> {
    const descriptor = this.panels.get(id);
    if (!descriptor) throw new Error(`PanelRegistry: no panel registered as "${id}"`);
    return descriptor;
  }

  list(): PanelDescriptor<Id>[] {
    return [...this.panels.values()];
  }

  ids(): Id[] {
    return [...this.panels.keys()];
  }

  /** The `components` map dockview needs. */
  componentMap(): Record<string, ComponentType<DockPanelComponentProps>> {
    const map: Record<string, ComponentType<DockPanelComponentProps>> = {};
    for (const [id, descriptor] of this.panels) map[id] = descriptor.component;
    return map;
  }

  byLocation(location: PanelLocation): PanelDescriptor<Id>[] {
    return this.list().filter((p) => p.defaultLocation === location);
  }
}
