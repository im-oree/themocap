/**
 * Workspace Browser panel (§B.4).
 *
 * Unifies two things the earlier documents had as separate screens: Document 2's
 * full-page Workspace Picker and Document 1's disabled sidebar nav. Both are
 * deleted; this panel is their replacement.
 *
 * The picker now renders *inside* the dock rather than as a full-screen wizard,
 * which is a real improvement: the user sees the editor they are about to work
 * in, rather than a disconnected setup page.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Badge,
  Button,
  cn,
  ContextMenu,
  Dialog,
  PromptDialog,
  Spinner,
  toast,
  useContextMenu,
  type MenuItemSpec,
} from '@wms/ui';

import { PROVIDER_INFO, PROVIDER_PRIORITY } from '../features/workspace/selectProvider';
import type { WorkspaceProviderId } from '../features/workspace/types';
import { useWorkspaceStore } from '../state/useWorkspaceStore';
import { useTakeStore, type TakeSummary } from '../state/useTakeStore';

export function WorkspaceBrowserPanel() {
  const ready = useWorkspaceStore((s) => s.ready);
  const init = useWorkspaceStore((s) => s.init);
  const capabilities = useWorkspaceStore((s) => s.capabilities);

  useEffect(() => {
    if (capabilities.available.length === 0) init();
  }, [capabilities.available.length, init]);

  return (
    <div className="h-full w-full overflow-auto bg-surface-light-elevated p-3 dark:bg-surface-dark-elevated">
      {ready ? <WorkspaceTree /> : <WorkspacePicker />}
    </div>
  );
}

/** Empty state: the old §10.4 picker, now panel-hosted. */
function WorkspacePicker() {
  const capabilities = useWorkspaceStore((s) => s.capabilities);
  const choose = useWorkspaceStore((s) => s.choose);
  const busy = useWorkspaceStore((s) => s.busy);
  const error = useWorkspaceStore((s) => s.error);

  return (
    <div className="flex flex-col gap-3">
      <div>
        <h2 className="text-[14px] font-semibold tracking-tight text-content-light-primary dark:text-content-dark-primary">
          Choose where recordings are saved
        </h2>
        <p className="mt-1 text-[12px] leading-relaxed text-content-light-secondary dark:text-content-dark-secondary">
          Everything stays on this machine. Nothing is uploaded.
        </p>
      </div>

      {error && (
        <p role="alert" className="rounded-lg bg-danger/10 px-2 py-1.5 text-[12px] text-danger">
          {error}
        </p>
      )}

      <ul className="flex flex-col gap-2">
        {PROVIDER_PRIORITY.map((id) => {
          const info = PROVIDER_INFO[id];
          const supported = capabilities.available.includes(id);
          return (
            <li
              key={id}
              className={cn(
                'rounded-xl border border-hairline-light p-2.5 dark:border-hairline-dark',
                !supported && 'opacity-45',
              )}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-[13px] font-medium text-content-light-primary dark:text-content-dark-primary">
                    {info.title}
                  </p>
                  <p className="mt-0.5 text-[11px] leading-snug text-content-light-secondary dark:text-content-dark-secondary">
                    {info.detail}
                  </p>
                  <p className="mt-1 text-[11px] leading-snug text-content-light-secondary/80 dark:text-content-dark-secondary/80">
                    {supported ? info.caveat : 'Not supported in this browser.'}
                  </p>
                </div>
                <Button
                  size="sm"
                  variant={id === capabilities.preferred ? 'primary' : 'secondary'}
                  disabled={!supported || busy}
                  onClick={() => void choose(id as WorkspaceProviderId)}
                >
                  {busy ? <Spinner size={13} /> : id === 'fsa' ? 'Choose Folder…' : 'Use'}
                </Button>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/** Formats a take duration as m:ss, which is how people talk about clips. */
function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return '—';
  const total = Math.round(seconds);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

/** Which pending dialog, if any, is open. Null means none. */
type PendingAction =
  | { kind: 'rename-project'; projectId: string; current: string }
  | { kind: 'rename-take'; projectId: string; takeId: string; current: string }
  | { kind: 'delete-project'; projectId: string; name: string; takeCount: number }
  | { kind: 'delete-take'; projectId: string; takeId: string; name: string }
  | null;

/**
 * Populated state: Workspace root → Projects → Takes (Document 3 §6.2).
 *
 * The tree data comes from `useTakeStore`, which owns take metadata; the
 * `WorkspaceManager` comes from `useWorkspaceStore`, which owns the provider.
 * Every mutation is routed through the take store so there is exactly one place
 * that knows how to keep the tree and the open take consistent.
 */
function WorkspaceTree() {
  const manager = useWorkspaceStore((s) => s.manager);
  const description = useWorkspaceStore((s) => s.description);

  const projects = useTakeStore((s) => s.projects);
  const loading = useTakeStore((s) => s.loading);
  const activeTakeId = useTakeStore((s) => s.activeTakeId);
  const loadProjects = useTakeStore((s) => s.loadProjects);

  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [pending, setPending] = useState<PendingAction>(null);
  const menu = useContextMenu();

  useEffect(() => {
    if (manager) void loadProjects(manager);
  }, [manager, loadProjects]);

  const refresh = useCallback(() => {
    if (manager) void loadProjects(manager);
  }, [manager, loadProjects]);

  /**
   * Wraps a mutation so a storage failure surfaces as a toast instead of an
   * unhandled rejection. A rename that silently fails is worse than one that
   * says why.
   */
  const run = useCallback(
    async (label: string, action: () => Promise<void>) => {
      try {
        await action();
      } catch (cause) {
        toast({
          title: `${label} failed`,
          description: cause instanceof Error ? cause.message : String(cause),
          tone: 'danger',
        });
      } finally {
        setPending(null);
      }
    },
    [],
  );

  const onConfirm = useCallback(() => {
    if (!manager || !pending) return;
    const store = useTakeStore.getState();
    switch (pending.kind) {
      case 'delete-project':
        void run('Delete project', () => store.deleteProject(manager, pending.projectId));
        break;
      case 'delete-take':
        void run('Delete take', () =>
          store.deleteTake(manager, pending.projectId, pending.takeId),
        );
        break;
      default:
        break;
    }
  }, [manager, pending, run]);

  const onRename = useCallback(
    (value: string) => {
      if (!manager || !pending) return;
      const store = useTakeStore.getState();
      if (pending.kind === 'rename-project') {
        void run('Rename project', () => store.renameProject(manager, pending.projectId, value));
      } else if (pending.kind === 'rename-take') {
        void run('Rename take', () =>
          store.renameTake(manager, pending.projectId, pending.takeId, value),
        );
      }
    },
    [manager, pending, run],
  );

  const openTake = useCallback(
    (projectId: string, takeId: string) => {
      if (!manager) return;
      void useTakeStore.getState().selectTake(manager, projectId, takeId);
    },
    [manager],
  );

  const projectMenu = useCallback(
    (projectId: string, name: string, takeCount: number): MenuItemSpec[] => [
      {
        kind: 'item',
        id: 'rename',
        label: 'Rename…',
        onSelect: () => setPending({ kind: 'rename-project', projectId, current: name }),
      },
      { kind: 'separator', id: 'sep' },
      {
        kind: 'item',
        id: 'delete',
        label: 'Delete Project',
        onSelect: () => setPending({ kind: 'delete-project', projectId, name, takeCount }),
      },
      { kind: 'separator', id: 'sep2' },
      { kind: 'item', id: 'refresh', label: 'Refresh', onSelect: refresh },
      { kind: 'item', id: 'id', label: `ID: ${projectId}`, disabled: true },
    ],
    [refresh],
  );

  const takeMenu = useCallback(
    (projectId: string, take: TakeSummary): MenuItemSpec[] => [
      { kind: 'item', id: 'open', label: 'Open', onSelect: () => openTake(projectId, take.id) },
      {
        kind: 'item',
        id: 'rename',
        label: 'Rename…',
        onSelect: () =>
          setPending({ kind: 'rename-take', projectId, takeId: take.id, current: take.name }),
      },
      { kind: 'separator', id: 'sep' },
      {
        kind: 'item',
        id: 'refine',
        label: 'Run Refine Pass…',
        // §8 lands next; the entry is present so the interaction is discoverable,
        // and disabled rather than silently doing nothing.
        disabled: true,
        hint: 'Arrives with the refine pipeline',
      },
      {
        kind: 'item',
        id: 'toggle-source',
        label: take.hasRefined ? 'Show Raw' : 'Show Refined',
        disabled: !take.hasRefined,
        hint: take.hasRefined ? undefined : 'No refined pass yet',
      },
      { kind: 'separator', id: 'sep2' },
      {
        kind: 'item',
        id: 'delete',
        label: 'Delete Take',
        onSelect: () =>
          setPending({ kind: 'delete-take', projectId, takeId: take.id, name: take.name }),
      },
    ],
    [openTake],
  );

  const deleteDescription = useMemo(() => {
    if (pending?.kind === 'delete-project') {
      return pending.takeCount === 0
        ? `"${pending.name}" will be permanently deleted.`
        : `"${pending.name}" and its ${pending.takeCount} take${
            pending.takeCount === 1 ? '' : 's'
          } will be permanently deleted. This cannot be undone.`;
    }
    if (pending?.kind === 'delete-take') {
      return `"${pending.name}" will be permanently deleted, including its video and motion data. This cannot be undone.`;
    }
    return undefined;
  }, [pending]);

  return (
    <div className="flex h-full flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        <p
          className="truncate text-[11px] text-content-light-secondary dark:text-content-dark-secondary"
          title={description}
        >
          {description}
        </p>
        <div className="flex shrink-0 items-center gap-1">
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              if (!manager) return;
              void run('Create project', () =>
                useTakeStore.getState().createProject(manager, `Project ${projects.length + 1}`),
              );
            }}
          >
            New Project
          </Button>
          <Button size="sm" variant="ghost" onClick={refresh} aria-label="Refresh workspace">
            {loading ? <Spinner size={13} /> : '⟳'}
          </Button>
        </div>
      </div>

      {projects.length === 0 ? (
        <p className="px-1 py-6 text-center text-[12px] text-content-light-secondary dark:text-content-dark-secondary">
          No projects yet. Create one, then record a take.
        </p>
      ) : (
        <ul role="tree" className="flex flex-col gap-1 overflow-auto" data-testid="workspace-tree">
          {projects.map((project) => {
            const isCollapsed = collapsed[project.id] ?? false;
            return (
              <li
                key={project.id}
                role="treeitem"
                aria-expanded={!isCollapsed}
                aria-selected={false}
              >
                <button
                  type="button"
                  onClick={() =>
                    setCollapsed((prev) => ({ ...prev, [project.id]: !isCollapsed }))
                  }
                  onContextMenu={(event) =>
                    menu.open(event, projectMenu(project.id, project.name, project.takes.length))
                  }
                  className="flex w-full items-center gap-1.5 rounded-md px-1.5 py-1 text-left text-[12px] font-medium text-content-light-primary hover:bg-black/[0.05] dark:text-content-dark-primary dark:hover:bg-white/[0.07]"
                >
                  <span
                    aria-hidden="true"
                    className="w-2 text-content-light-secondary dark:text-content-dark-secondary"
                  >
                    {isCollapsed ? '▸' : '▾'}
                  </span>
                  <span className="truncate">{project.name}</span>
                  <span className="ml-auto shrink-0 text-[10px] tabular-nums text-content-light-secondary dark:text-content-dark-secondary">
                    {project.takes.length}
                  </span>
                </button>

                {!isCollapsed && (
                  <ul
                    role="group"
                    className="ml-4 flex flex-col gap-0.5 border-l border-hairline-light pl-2 dark:border-hairline-dark"
                  >
                    {project.takes.length === 0 ? (
                      <li className="px-1.5 py-1 text-[11px] text-content-light-secondary dark:text-content-dark-secondary">
                        No takes yet
                      </li>
                    ) : (
                      project.takes.map((take) => (
                        <li
                          key={take.id}
                          role="treeitem"
                          aria-selected={take.id === activeTakeId}
                        >
                          <button
                            type="button"
                            data-testid="take-row"
                            onClick={() => openTake(project.id, take.id)}
                            onContextMenu={(event) => menu.open(event, takeMenu(project.id, take))}
                            className={cn(
                              'flex w-full items-center gap-1.5 rounded-md px-1.5 py-1 text-left text-[11px]',
                              'text-content-light-secondary hover:bg-black/[0.05] dark:text-content-dark-secondary dark:hover:bg-white/[0.07]',
                              take.id === activeTakeId &&
                                'bg-accent/10 text-content-light-primary dark:text-content-dark-primary',
                            )}
                          >
                            <span className="truncate">{take.name}</span>
                            {take.problems.length > 0 && (
                              <Badge tone="warning" title={take.problems.join('; ')}>
                                damaged
                              </Badge>
                            )}
                            {take.hasRefined && <Badge tone="success">refined</Badge>}
                            <span className="ml-auto shrink-0 tabular-nums opacity-70">
                              {formatDuration(take.durationSec)}
                            </span>
                          </button>
                        </li>
                      ))
                    )}
                  </ul>
                )}
              </li>
            );
          })}
        </ul>
      )}

      <ContextMenu state={menu.state} onClose={menu.close} />

      <PromptDialog
        open={pending?.kind === 'rename-project' || pending?.kind === 'rename-take'}
        title={pending?.kind === 'rename-take' ? 'Rename Take' : 'Rename Project'}
        label="Name"
        initialValue={
          pending?.kind === 'rename-project' || pending?.kind === 'rename-take'
            ? pending.current
            : ''
        }
        onConfirm={onRename}
        onCancel={() => setPending(null)}
      />

      <Dialog
        open={pending?.kind === 'delete-project' || pending?.kind === 'delete-take'}
        title={pending?.kind === 'delete-project' ? 'Delete Project?' : 'Delete Take?'}
        description={deleteDescription}
        confirmLabel="Delete"
        destructive
        onConfirm={onConfirm}
        onCancel={() => setPending(null)}
      />
    </div>
  );
}
