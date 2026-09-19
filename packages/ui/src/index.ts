export { cn } from './cn';
export type { ClassValue } from './cn';

export {
  useThemeStore,
  applyTheme,
  resolveTheme,
  THEME_STORAGE_KEY,
  type ThemeChoice,
  type ResolvedTheme,
} from './theme';

export { Panel, type PanelProps } from './components/Panel';
export { Button, type ButtonProps, type ButtonVariant, type ButtonSize } from './components/Button';
export { IconButton, type IconButtonProps } from './components/IconButton';
export { Toolbar, type ToolbarProps } from './components/Toolbar';
export { Sidebar, type SidebarProps, type SidebarItem } from './components/Sidebar';
export { Tooltip, type TooltipProps } from './components/Tooltip';
export { Slider, type SliderProps } from './components/Slider';
export {
  Badge,
  StatusDot,
  type BadgeProps,
  type StatusDotProps,
  type StatusTone,
} from './components/Badge';
export { Toaster, toast, useToastStore, type Toast } from './components/Toast';
export { ThemeToggle } from './components/ThemeToggle';
export { PerfHUD } from './dev/PerfHUD';
export * from './icons';

// ---- Menus (addendum §A.3, §B.4) ----
export { MenuBar, Menu, type MenuProps, type MenuItemSpec } from './menu/Menu';
export {
  ContextMenu,
  useContextMenu,
  type ContextMenuProps,
  type ContextMenuState,
} from './menu/ContextMenu';

// ---- Docking system (addendum §A.2) ----
export { DockRoot, type DockRootProps } from './dock/DockRoot';
export {
  PanelRegistry,
  type PanelDescriptor,
  type PanelLocation,
  type DockPanelComponentProps,
} from './dock/panelRegistry';
export {
  applyDefaultLayout,
  openPanelAtDefaultLocation,
  type ApplyDefaultLayoutOptions,
} from './dock/defaultLayout';
export {
  LayoutStore,
  debounceLayoutSave,
  parseStoredLayouts,
  LAYOUT_STORAGE_KEY,
  LAYOUT_SCHEMA_VERSION,
  LAYOUT_FILE,
  type SerializedLayout,
  type StoredLayouts,
  type LayoutStorageBackend,
} from './dock/layoutPersistence';
export { useDockApi, type DockController } from './dock/useDockApi';
export { Spinner, type SpinnerProps } from './components/Spinner';
