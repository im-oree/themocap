/**
 * Application menu bar (§A.3).
 *
 * Menu *structure* is fixed now and does not change in later documents — they
 * only add items to these same menus. Anything not yet implemented is present
 * but disabled with a "Coming in Document N" hint, so the eventual shape of the
 * app is visible from the start instead of appearing as surprise new menus.
 */

import { Menu, MenuBar as MenuBarPrimitive, type DockController, type MenuItemSpec } from '@wms/ui';

import type { PanelTypeId } from '../dock/layoutDefaults';
import { PANEL_DESCRIPTORS } from '../dock/layoutDefaults';
import { useEditorStore } from '../state/useEditorStore';
import { useWorkspaceStore } from '../state/useWorkspaceStore';
import { WorkspaceSwitcher } from './WorkspaceSwitcher';

/** `⌘` on Apple platforms, `Ctrl` elsewhere — shown in shortcut hints. */
const MOD =
  typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform ?? '')
    ? '⌘'
    : 'Ctrl';

export interface AppMenuBarProps {
  dock: DockController<PanelTypeId>;
}

export function AppMenuBar({ dock }: AppMenuBarProps) {
  const setPropertiesContext = useEditorStore((s) => s.setPropertiesContext);
  const requestCamera = useEditorStore((s) => s.requestCamera);
  const viewport = useEditorStore((s) => s.viewport);
  const toggleViewport = useEditorStore((s) => s.toggleViewport);
  const createProject = useWorkspaceStore((s) => s.createProject);
  const workspaceReady = useWorkspaceStore((s) => s.ready);

  const openProperties = (context: Parameters<typeof setPropertiesContext>[0]) => {
    setPropertiesContext(context);
    dock.focus('properties');
  };

  const fileItems: MenuItemSpec[] = [
    {
      kind: 'item',
      id: 'new-project',
      label: 'New Project',
      shortcut: `${MOD}N`,
      disabled: !workspaceReady,
      hint: workspaceReady ? undefined : 'Choose a workspace first',
      onSelect: () => void createProject('Untitled Project'),
    },
    {
      kind: 'item',
      id: 'open-project',
      label: 'Open Project…',
      disabled: true,
      hint: 'Arrives in Document 3',
    },
    {
      kind: 'item',
      id: 'recent',
      label: 'Recent Projects',
      disabled: true,
      hint: 'Arrives in Document 3',
    },
    { kind: 'separator', id: 'sep1' },
    {
      kind: 'item',
      id: 'choose-workspace',
      label: 'Choose Workspace Folder…',
      onSelect: () => dock.focus('workspaceBrowser'),
    },
    { kind: 'separator', id: 'sep2' },
    {
      kind: 'item',
      id: 'export-bvh',
      label: 'Export ▸ BVH…',
      shortcut: `${MOD}E`,
      // Opens the Properties panel in export context rather than a modal (§B.5).
      onSelect: () => openProperties({ kind: 'export' }),
    },
    { kind: 'separator', id: 'sep3' },
    { kind: 'item', id: 'close-take', label: 'Close Take', disabled: true, hint: 'No take open' },
  ];

  const editItems: MenuItemSpec[] = [
    {
      kind: 'item',
      id: 'undo',
      label: 'Undo',
      shortcut: `${MOD}Z`,
      disabled: true,
      hint: 'Available in Editor mode',
    },
    {
      kind: 'item',
      id: 'redo',
      label: 'Redo',
      shortcut: `⇧${MOD}Z`,
      disabled: true,
      hint: 'Available in Editor mode',
    },
    { kind: 'separator', id: 'sep1' },
    {
      kind: 'item',
      id: 'preferences',
      label: 'Preferences…',
      shortcut: `${MOD},`,
      onSelect: () => openProperties({ kind: 'preferences' }),
    },
  ];

  const viewItems: MenuItemSpec[] = [
    {
      kind: 'item',
      id: 'reset-camera',
      label: 'Reset Viewport Camera',
      onSelect: () => requestCamera('reset'),
    },
    {
      kind: 'item',
      id: 'frame-selected',
      label: 'Frame Selected',
      shortcut: '.',
      onSelect: () => requestCamera('frameSelected'),
    },
    { kind: 'separator', id: 'sep1' },
    {
      kind: 'checkbox',
      id: 'toggle-grid',
      label: 'Grid',
      checked: viewport.grid,
      onSelect: () => toggleViewport('grid'),
    },
    {
      kind: 'checkbox',
      id: 'toggle-gizmo',
      label: 'Navigation Gizmo',
      checked: viewport.navGizmo,
      onSelect: () => toggleViewport('navGizmo'),
    },
    {
      kind: 'checkbox',
      id: 'toggle-frustum',
      label: 'Camera Frustum',
      checked: viewport.cameraFrustum,
      onSelect: () => toggleViewport('cameraFrustum'),
    },
    {
      kind: 'checkbox',
      id: 'toggle-stats',
      label: 'Stats Overlay',
      checked: viewport.stats,
      onSelect: () => toggleViewport('stats'),
    },
  ];

  // Checkbox state comes from the live dock, so the menu can never claim a panel
  // is open when it is not (§A.9 item 4).
  const panelItems: MenuItemSpec[] = [
    ...PANEL_DESCRIPTORS.map<MenuItemSpec>((descriptor) => ({
      kind: 'checkbox',
      id: `panel-${descriptor.id}`,
      label: descriptor.title,
      checked: dock.isOpen(descriptor.id),
      disabled: !descriptor.closable && dock.isOpen(descriptor.id),
      hint: descriptor.closable ? descriptor.description : 'This panel cannot be closed',
      onSelect: () => dock.toggle(descriptor.id),
    })),
    { kind: 'separator', id: 'sep1' },
    {
      kind: 'item',
      id: 'reset-layout',
      label: 'Reset Layout to Default',
      onSelect: () => dock.resetLayout(),
    },
  ];

  const helpItems: MenuItemSpec[] = [
    {
      kind: 'item',
      id: 'shortcuts',
      label: 'Keyboard Shortcuts',
      onSelect: () => openProperties({ kind: 'preferences' }),
    },
    { kind: 'item', id: 'about', label: `About Web Mocap Studio`, disabled: true },
    {
      kind: 'item',
      id: 'licenses',
      label: 'License List',
      disabled: true,
      hint: 'Full license screen arrives in Document 6',
    },
  ];

  return (
    <div className="flex h-9 shrink-0 items-center justify-between border-b border-hairline-light bg-surface-light-elevated px-2 dark:border-hairline-dark dark:bg-surface-dark-elevated">
      <MenuBarPrimitive>
        <Menu id="file" label="File" items={fileItems} />
        <Menu id="edit" label="Edit" items={editItems} />
        <Menu id="view" label="View" items={viewItems} />
        <Menu id="panels" label="Panels" items={panelItems} />
        <Menu id="help" label="Help" items={helpItems} />
      </MenuBarPrimitive>

      <WorkspaceSwitcher />
    </div>
  );
}
