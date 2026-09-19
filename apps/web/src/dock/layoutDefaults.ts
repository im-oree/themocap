/**
 * App-level panel registration.
 *
 * This is the one file that knows both what panels exist and what they contain.
 * `@wms/ui` owns the docking mechanism; this owns the content, which keeps the
 * UI package free of app dependencies and independently testable.
 */

import { PanelRegistry, type PanelDescriptor } from '@wms/ui';
import {
  Activity,
  Box,
  Folder,
  Gauge,
  Monitor,
  SlidersHorizontal,
} from 'lucide-react';

import { DiagnosticsPanel } from '../panels/DiagnosticsPanel';
import { PropertiesPanel } from '../panels/PropertiesPanel';
import { TimelinePanel } from '../panels/TimelinePanel';
import { ViewportPanel } from '../panels/ViewportPanel';
import { VideoMonitorPanel } from '../panels/VideoMonitorPanel';
import { WorkspaceBrowserPanel } from '../panels/WorkspaceBrowserPanel';

export type PanelTypeId =
  | 'viewport3d'
  | 'videoMonitor'
  | 'timeline'
  | 'workspaceBrowser'
  | 'properties'
  | 'diagnostics';

export const PANEL_DESCRIPTORS: PanelDescriptor<PanelTypeId>[] = [
  {
    id: 'viewport3d',
    title: 'Viewport',
    component: ViewportPanel,
    defaultLocation: 'center-top',
    // Not closable: an editor with no viewport has nothing to edit, and closing
    // it would destroy the WebGL context for no good reason.
    closable: false,
    icon: Box,
    openByDefault: true,
    description: '3D rig preview',
  },
  {
    id: 'videoMonitor',
    title: 'Video Monitor',
    component: VideoMonitorPanel,
    defaultLocation: 'center-bottom',
    closable: true,
    icon: Monitor,
    openByDefault: true,
    defaultSize: 260,
    description: 'Source frame with 2D overlay',
  },
  {
    id: 'workspaceBrowser',
    title: 'Workspace',
    component: WorkspaceBrowserPanel,
    defaultLocation: 'left',
    closable: true,
    icon: Folder,
    openByDefault: true,
    defaultSize: 260,
    description: 'Projects and takes',
  },
  {
    id: 'properties',
    title: 'Properties',
    component: PropertiesPanel,
    defaultLocation: 'right',
    closable: true,
    icon: SlidersHorizontal,
    openByDefault: true,
    defaultSize: 300,
    description: 'Contextual settings and inspector',
  },
  {
    id: 'timeline',
    title: 'Timeline',
    component: TimelinePanel,
    defaultLocation: 'bottom-full',
    closable: true,
    icon: Activity,
    openByDefault: true,
    defaultSize: 140,
    description: 'Playhead and scrub bar',
  },
  {
    id: 'diagnostics',
    title: 'Diagnostics',
    component: DiagnosticsPanel,
    defaultLocation: 'float',
    closable: true,
    icon: Gauge,
    // Closed by default: useful when something is wrong, clutter otherwise.
    openByDefault: false,
    description: 'Capabilities and pipeline health',
  },
];

export function createPanelRegistry(): PanelRegistry<PanelTypeId> {
  return new PanelRegistry<PanelTypeId>().registerAll(PANEL_DESCRIPTORS);
}
