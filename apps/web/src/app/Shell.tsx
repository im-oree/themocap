import {
  Badge,
  Button,
  CameraIcon,
  CubeIcon,
  ExportIcon,
  FilmIcon,
  GearIcon,
  IconButton,
  Panel,
  PerfHUD,
  Sidebar,
  SidebarIcon,
  SlidersIcon,
  StatusDot,
  ThemeToggle,
  Toaster,
  Toolbar,
  Tooltip,
  type SidebarItem,
  type StatusTone,
} from '@wms/ui';
import { useAppStore } from '../state/useAppStore';
import { Diagnostics } from './Diagnostics';

const NAV_ITEMS: SidebarItem[] = [
  { id: 'live', label: 'Live', icon: <CameraIcon />, disabled: true, hint: 'Coming in Document 2' },
  { id: 'takes', label: 'Takes', icon: <FilmIcon />, disabled: true, hint: 'Coming in Document 3' },
  {
    id: 'editor',
    label: 'Editor',
    icon: <SlidersIcon />,
    disabled: true,
    hint: 'Coming in Document 4',
  },
  {
    id: 'export',
    label: 'Export',
    icon: <ExportIcon />,
    disabled: true,
    hint: 'Coming in Document 6',
  },
  {
    id: 'settings',
    label: 'Settings',
    icon: <GearIcon />,
    disabled: true,
    hint: 'Coming in Document 6',
  },
];

const READINESS_TONE: Record<string, StatusTone> = {
  unknown: 'neutral',
  ready: 'success',
  incomplete: 'warning',
};

const BUILD_VERSION = __APP_VERSION__;
const BUILD_ENV = import.meta.env.DEV ? 'dev' : 'prod';

function Logo() {
  return (
    <span className="flex items-center gap-2">
      <span className="flex h-7 w-7 items-center justify-center rounded-[8px] bg-accent text-white">
        <CubeIcon width={16} height={16} />
      </span>
      <span className="text-[15px] font-semibold tracking-tight">Web Mocap Studio</span>
    </span>
  );
}

export function Shell() {
  const collapsed = useAppStore((s) => s.sidebarCollapsed);
  const toggleSidebar = useAppStore((s) => s.toggleSidebar);
  const activeSection = useAppStore((s) => s.activeSection);
  const readiness = useAppStore((s) => s.offlineReadiness);
  const devFlags = useAppStore((s) => s.devFlags);

  return (
    <div className="flex h-full min-h-screen flex-col bg-surface-light dark:bg-surface-dark">
      <Toolbar
        leading={
          <>
            <IconButton
              label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
              icon={<SidebarIcon />}
              onClick={toggleSidebar}
              active={!collapsed}
              className="h-9 w-9"
            />
            <Logo />
          </>
        }
        trailing={
          <>
            <Tooltip content={`Offline readiness: ${readiness}`}>
              <span className="flex items-center gap-2 rounded-lg px-2 py-1 text-xs text-content-light-secondary dark:text-content-dark-secondary">
                <StatusDot
                  tone={READINESS_TONE[readiness] ?? 'neutral'}
                  label={`Offline readiness: ${readiness}`}
                />
                <span aria-hidden="true">Offline: {readiness}</span>
              </span>
            </Tooltip>
            <ThemeToggle />
            <Tooltip content="Settings — coming in Document 6">
              <span>
                <IconButton label="Settings" icon={<GearIcon />} disabled className="h-9 w-9" />
              </span>
            </Tooltip>
          </>
        }
      />

      <div className="flex min-h-0 flex-1">
        <Sidebar
          items={NAV_ITEMS}
          activeId={activeSection}
          collapsed={collapsed}
          footer={
            !collapsed ? (
              <p className="px-1 text-[11px] leading-snug text-content-light-secondary dark:text-content-dark-secondary">
                Foundation build. Panels arrive in later documents.
              </p>
            ) : null
          }
        />

        <main className="min-w-0 flex-1 overflow-auto p-6">
          <div className="mx-auto flex w-full max-w-3xl flex-col gap-5">
            <Panel className="animate-fade-in">
              <h1 className="text-2xl font-semibold tracking-tight">Foundation ready</h1>
              <p className="mt-2 max-w-prose text-sm leading-relaxed text-content-light-secondary dark:text-content-dark-secondary">
                The monorepo, design system, and Rust&nbsp;→&nbsp;WASM compute bridge are wired up.
                Camera capture, pose inference, and export land in the next documents. Everything
                below runs locally — this app makes no network calls beyond its own origin.
              </p>
              <div className="mt-4 flex flex-wrap items-center gap-2">
                <Badge tone="accent">Document 1</Badge>
                <Badge tone={devFlags.strictOffline ? 'success' : 'neutral'}>
                  {devFlags.strictOffline ? 'Strict offline' : 'Offline guard: warn'}
                </Badge>
                <Badge tone="neutral">{BUILD_ENV}</Badge>
              </div>
            </Panel>

            {import.meta.env.DEV && (
              <Panel
                title="Diagnostics"
                actions={
                  <Button size="sm" variant="ghost" onClick={() => window.location.reload()}>
                    Re-run
                  </Button>
                }
              >
                <Diagnostics />
              </Panel>
            )}
          </div>
        </main>
      </div>

      <footer className="flex h-8 shrink-0 items-center justify-between border-t border-hairline-light bg-white/60 px-4 text-[11px] text-content-light-secondary backdrop-blur-xl dark:border-hairline-dark dark:bg-surface-dark-elevated/60 dark:text-content-dark-secondary">
        <span data-testid="frame-counter">Frames: —</span>
        <span className="flex items-center gap-3">
          <span>v{BUILD_VERSION}</span>
          <span>{BUILD_ENV}</span>
        </span>
      </footer>

      {import.meta.env.DEV && <PerfHUD />}
      <Toaster />
    </div>
  );
}
