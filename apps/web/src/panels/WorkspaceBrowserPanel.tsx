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

import { useEffect } from 'react';
import { Button, cn, ContextMenu, Spinner, useContextMenu, type MenuItemSpec } from '@wms/ui';

import { PROVIDER_INFO, PROVIDER_PRIORITY } from '../features/workspace/selectProvider';
import type { WorkspaceProviderId } from '../features/workspace/types';
import { useWorkspaceStore } from '../state/useWorkspaceStore';

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

/** Populated state: Workspace root → Projects → Takes. */
function WorkspaceTree() {
  const projects = useWorkspaceStore((s) => s.projects);
  const description = useWorkspaceStore((s) => s.description);
  const refresh = useWorkspaceStore((s) => s.refresh);
  const deleteTake = useWorkspaceStore((s) => s.deleteTake);
  const createProject = useWorkspaceStore((s) => s.createProject);
  const menu = useContextMenu();

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Document 3 wires the real CRUD; the chrome exists now so that work is
  // behaviour-only. Items that do nothing yet say so rather than failing silently.
  const projectMenu = (projectId: string): MenuItemSpec[] => [
    { kind: 'item', id: 'rename', label: 'Rename…', disabled: true, hint: 'Arrives in Document 3' },
    { kind: 'item', id: 'reveal', label: 'Reveal', disabled: true, hint: 'Arrives in Document 3' },
    { kind: 'separator', id: 'sep' },
    {
      kind: 'item',
      id: 'delete',
      label: 'Delete Project',
      disabled: true,
      hint: 'Arrives in Document 3',
    },
    { kind: 'separator', id: 'sep2' },
    { kind: 'item', id: 'refresh', label: 'Refresh', onSelect: () => void refresh() },
    { kind: 'item', id: 'id', label: `ID: ${projectId}`, disabled: true },
  ];

  const takeMenu = (projectId: string, takeId: string): MenuItemSpec[] => [
    { kind: 'item', id: 'rename', label: 'Rename…', disabled: true, hint: 'Arrives in Document 3' },
    { kind: 'item', id: 'reveal', label: 'Reveal', disabled: true, hint: 'Arrives in Document 3' },
    { kind: 'separator', id: 'sep' },
    {
      kind: 'item',
      id: 'delete',
      label: 'Delete Take',
      onSelect: () => void deleteTake(projectId, takeId),
    },
  ];

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        <p
          className="truncate text-[11px] text-content-light-secondary dark:text-content-dark-secondary"
          title={description}
        >
          {description}
        </p>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => void createProject(`Project ${projects.length + 1}`)}
        >
          New Project
        </Button>
      </div>

      {projects.length === 0 ? (
        <p className="px-1 py-6 text-center text-[12px] text-content-light-secondary dark:text-content-dark-secondary">
          No projects yet. Create one, then record a take.
        </p>
      ) : (
        <ul role="tree" className="flex flex-col gap-1" data-testid="workspace-tree">
          {projects.map((project) => (
            <li key={project.id} role="treeitem" aria-expanded aria-selected={false}>
              <button
                type="button"
                onContextMenu={(event) => menu.open(event, projectMenu(project.id))}
                className="flex w-full items-center gap-1.5 rounded-md px-1.5 py-1 text-left text-[12px] font-medium text-content-light-primary hover:bg-black/[0.05] dark:text-content-dark-primary dark:hover:bg-white/[0.07]"
              >
                <span aria-hidden="true" className="text-content-light-secondary dark:text-content-dark-secondary">
                  ▾
                </span>
                <span className="truncate">{project.name}</span>
              </button>

              <ul role="group" className="ml-4 flex flex-col gap-0.5 border-l border-hairline-light pl-2 dark:border-hairline-dark">
                {project.takes.length === 0 ? (
                  <li className="px-1.5 py-1 text-[11px] text-content-light-secondary dark:text-content-dark-secondary">
                    No takes yet
                  </li>
                ) : (
                  project.takes.map((take) => (
                    <li key={take.id} role="treeitem" aria-selected={false}>
                      <button
                        type="button"
                        onContextMenu={(event) => menu.open(event, takeMenu(project.id, take.id))}
                        className="w-full truncate rounded-md px-1.5 py-1 text-left font-mono text-[11px] text-content-light-secondary hover:bg-black/[0.05] dark:text-content-dark-secondary dark:hover:bg-white/[0.07]"
                      >
                        {take.name}
                      </button>
                    </li>
                  ))
                )}
              </ul>
            </li>
          ))}
        </ul>
      )}

      <ContextMenu state={menu.state} onClose={menu.close} />
    </div>
  );
}
