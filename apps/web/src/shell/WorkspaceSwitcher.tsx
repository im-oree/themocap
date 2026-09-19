/**
 * Workspace tabs (§A.8): Live | Edit.
 *
 * "Workspace" here means a named panel arrangement, in the Blender sense — not
 * the storage folder, which the Workspace Browser owns. Unfortunate collision,
 * but both names are established in their own domains.
 *
 * Edit is present but disabled: showing where editing will live is honest and
 * useful; letting a user switch into an empty shell is not.
 */

import { cn } from '@wms/ui';

import { useEditorStore, type WorkspaceTabId } from '../state/useEditorStore';

const TABS: { id: WorkspaceTabId; label: string; enabled: boolean; hint: string }[] = [
  { id: 'live', label: 'Live', enabled: true, hint: 'Capture and preview' },
  { id: 'edit', label: 'Edit', enabled: false, hint: 'Editing tools arrive in Document 4' },
];

export function WorkspaceSwitcher() {
  const activeTab = useEditorStore((s) => s.activeTab);
  const setActiveTab = useEditorStore((s) => s.setActiveTab);

  return (
    <div
      role="tablist"
      aria-label="Workspace"
      data-testid="workspace-tabs"
      className="flex items-center gap-0.5 rounded-lg bg-black/[0.05] p-0.5 dark:bg-white/[0.07]"
    >
      {TABS.map((tab) => {
        const selected = activeTab === tab.id;
        return (
          <button
            key={tab.id}
            role="tab"
            type="button"
            aria-selected={selected}
            aria-disabled={!tab.enabled}
            title={tab.hint}
            data-testid={`workspace-tab-${tab.id}`}
            onClick={() => tab.enabled && setActiveTab(tab.id)}
            className={cn(
              'rounded-[6px] px-2.5 py-0.5 text-[12px] font-medium transition-colors duration-150 ease-apple-out',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent',
              selected
                ? 'bg-surface-light-elevated text-content-light-primary shadow-sm dark:bg-surface-dark dark:text-content-dark-primary'
                : 'text-content-light-secondary dark:text-content-dark-secondary',
              !tab.enabled && 'cursor-not-allowed opacity-40',
            )}
          >
            {tab.label}
          </button>
        );
      })}
    </div>
  );
}
