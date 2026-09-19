/**
 * Document 3 §6.2: the Workspace Browser's populated state.
 *
 * Renders the real panel against a real WorkspaceManager over an in-memory
 * OPFS. Nothing is mocked except the browser storage root, so a test passing
 * here means the tree, the context menus, the dialogs and the storage layer
 * genuinely agree with each other.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';

import { WorkspaceBrowserPanel } from '../../src/panels/WorkspaceBrowserPanel';
import { WorkspaceManager } from '../../src/features/workspace/WorkspaceManager';
import { OpfsWorkspaceProvider } from '../../src/features/workspace/providers/opfsProvider';
import { useWorkspaceStore } from '../../src/state/useWorkspaceStore';
import { useTakeStore } from '../../src/state/useTakeStore';
import type { TakeManifest } from '../../src/features/workspace/layout';
import { MemoryDirectoryHandle } from './memoryFileSystem';

let manager: WorkspaceManager;

async function addTake(projectId: string, name: string, durationSeconds = 65) {
  const takeId = await manager.createTake({ projectId, name });
  const manifest: TakeManifest = {
    version: 1,
    id: takeId,
    name,
    projectId,
    createdAt: new Date().toISOString(),
    durationSeconds,
    frameCount: Math.round(durationSeconds * 30),
    captureFps: 30,
    inferenceFps: 15,
    source: { kind: 'camera', label: 'cam', width: 640, height: 480 },
    models: { detector: null, pose2d: null, lift3d: null },
    files: { video: null, keypoints: 'raw-keypoints.bin', thumbnail: null },
    twistEstimatedJoints: [],
  };
  await manager.finalizeTake(manifest);
  return takeId;
}

/** Right-clicks a row and returns the resulting menu. */
function openContextMenu(element: HTMLElement) {
  fireEvent.contextMenu(element);
  return screen.getByRole('menu');
}

beforeEach(async () => {
  const root = new MemoryDirectoryHandle('ws');
  vi.stubGlobal('navigator', {
    storage: { getDirectory: async () => root, estimate: async () => ({ usage: 0 }) },
  });
  const provider = new OpfsWorkspaceProvider();
  await provider.requestAccess();
  manager = new WorkspaceManager(provider);
  await manager.initialize();

  // Put the workspace store into its "ready" state so the panel renders the
  // tree rather than the provider picker.
  useWorkspaceStore.setState({
    ready: true,
    manager,
    description: 'In-memory workspace',
    busy: false,
    error: null,
    // Non-empty so the panel does not kick off provider detection, which would
    // race with the state we just installed.
    capabilities: { available: ['opfs'], preferred: 'opfs', requiresUserGesture: false },
  });
  useTakeStore.setState({
    projects: [],
    activeProjectId: null,
    activeTakeId: null,
    activeTake: null,
    activeSettings: null,
    loading: false,
    error: null,
  });
});

describe('tree rendering', () => {
  it('shows an empty-workspace message', async () => {
    render(<WorkspaceBrowserPanel />);
    expect(await screen.findByText(/No projects yet/)).toBeInTheDocument();
  });

  it('renders projects and their takes', async () => {
    const project = await manager.createProject('Session A');
    await addTake(project.id, 'Take 1');
    await addTake(project.id, 'Take 2');

    render(<WorkspaceBrowserPanel />);

    expect(await screen.findByText('Session A')).toBeInTheDocument();
    expect(await screen.findByText('Take 1')).toBeInTheDocument();
    expect(await screen.findByText('Take 2')).toBeInTheDocument();
  });

  it('shows the take duration as m:ss', async () => {
    const project = await manager.createProject('P');
    await addTake(project.id, 'Long Take', 65);

    render(<WorkspaceBrowserPanel />);

    expect(await screen.findByText('1:05')).toBeInTheDocument();
  });

  it('badges a refined take', async () => {
    const project = await manager.createProject('P');
    const takeId = await addTake(project.id, 'Refined Take');
    await manager.writeTakeRefined(project.id, takeId, new Uint8Array([1]));

    render(<WorkspaceBrowserPanel />);

    expect(await screen.findByText('refined')).toBeInTheDocument();
  });

  it('collapses and expands a project', async () => {
    const project = await manager.createProject('Session A');
    await addTake(project.id, 'Take 1');

    render(<WorkspaceBrowserPanel />);
    const header = await screen.findByRole('button', { name: /Session A/ });
    expect(await screen.findByText('Take 1')).toBeInTheDocument();

    fireEvent.click(header);
    await waitFor(() => expect(screen.queryByText('Take 1')).toBeNull());

    fireEvent.click(header);
    expect(await screen.findByText('Take 1')).toBeInTheDocument();
  });

  it('marks the open take as selected', async () => {
    const project = await manager.createProject('P');
    await addTake(project.id, 'Take 1');

    render(<WorkspaceBrowserPanel />);
    fireEvent.click(await screen.findByTestId('take-row'));

    await waitFor(() => {
      expect(screen.getByTestId('take-row').closest('[role="treeitem"]')).toHaveAttribute(
        'aria-selected',
        'true',
      );
    });
  });
});

describe('take context menu', () => {
  it('offers Open, Rename, Refine and Delete', async () => {
    const project = await manager.createProject('P');
    await addTake(project.id, 'Take 1');
    render(<WorkspaceBrowserPanel />);

    const menu = openContextMenu(await screen.findByTestId('take-row'));

    expect(within(menu).getByText('Open')).toBeInTheDocument();
    expect(within(menu).getByText('Rename…')).toBeInTheDocument();
    expect(within(menu).getByText('Run Refine Pass…')).toBeInTheDocument();
    expect(within(menu).getByText('Delete Take')).toBeInTheDocument();
  });

  it('disables the raw/refined toggle until a refine pass exists', async () => {
    const project = await manager.createProject('P');
    await addTake(project.id, 'Take 1');
    render(<WorkspaceBrowserPanel />);

    const menu = openContextMenu(await screen.findByTestId('take-row'));
    // ContextMenu renders items as real <button> elements, so disabling is the
    // native attribute rather than aria-disabled.
    expect(within(menu).getByText('Show Refined').closest('[role="menuitem"]')).toBeDisabled();
  });
});

describe('rename', () => {
  it('renames a take through the dialog and keeps its id', async () => {
    const project = await manager.createProject('P');
    const takeId = await addTake(project.id, 'Old Name');
    render(<WorkspaceBrowserPanel />);

    const menu = openContextMenu(await screen.findByTestId('take-row'));
    fireEvent.click(within(menu).getByText('Rename…'));

    const input = await screen.findByTestId('dialog-input');
    expect((input as HTMLInputElement).value).toBe('Old Name');
    fireEvent.change(input, { target: { value: 'New Name' } });
    fireEvent.click(screen.getByTestId('dialog-confirm'));

    expect(await screen.findByText('New Name')).toBeInTheDocument();
    // Renaming must be metadata-only: the folder id is unchanged.
    expect(await manager.listTakeIds(project.id)).toEqual([takeId]);
    expect((await manager.readTake(project.id, takeId)).name).toBe('New Name');
  });

  it('renames a project without moving its folder', async () => {
    const project = await manager.createProject('Before');
    render(<WorkspaceBrowserPanel />);

    const menu = openContextMenu(await screen.findByRole('button', { name: /Before/ }));
    fireEvent.click(within(menu).getByText('Rename…'));

    fireEvent.change(await screen.findByTestId('dialog-input'), {
      target: { value: 'After' },
    });
    fireEvent.click(screen.getByTestId('dialog-confirm'));

    expect(await screen.findByText('After')).toBeInTheDocument();
    expect(await manager.listProjectIds()).toEqual([project.id]);
  });

  it('cancelling the dialog changes nothing', async () => {
    const project = await manager.createProject('P');
    await addTake(project.id, 'Untouched');
    render(<WorkspaceBrowserPanel />);

    const menu = openContextMenu(await screen.findByTestId('take-row'));
    fireEvent.click(within(menu).getByText('Rename…'));
    fireEvent.change(await screen.findByTestId('dialog-input'), { target: { value: 'Nope' } });
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(screen.getByText('Untouched')).toBeInTheDocument();
  });
});

describe('delete', () => {
  it('asks for confirmation in a styled dialog, never window.confirm', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm');
    const project = await manager.createProject('P');
    await addTake(project.id, 'Doomed');
    render(<WorkspaceBrowserPanel />);

    const menu = openContextMenu(await screen.findByTestId('take-row'));
    fireEvent.click(within(menu).getByText('Delete Take'));

    expect(await screen.findByRole('dialog')).toHaveAccessibleName('Delete Take?');
    // Native confirm blocks the main thread and can be suppressed by the
    // browser, silently turning Delete into a no-op.
    expect(confirmSpy).not.toHaveBeenCalled();
  });

  it('deletes the take after confirmation', async () => {
    const project = await manager.createProject('P');
    const takeId = await addTake(project.id, 'Doomed');
    render(<WorkspaceBrowserPanel />);

    const menu = openContextMenu(await screen.findByTestId('take-row'));
    fireEvent.click(within(menu).getByText('Delete Take'));
    fireEvent.click(await screen.findByTestId('dialog-confirm'));

    await waitFor(() => expect(screen.queryByText('Doomed')).toBeNull());
    expect(await manager.listTakeIds(project.id)).not.toContain(takeId);
  });

  it('keeps the take when the dialog is cancelled', async () => {
    const project = await manager.createProject('P');
    const takeId = await addTake(project.id, 'Survivor');
    render(<WorkspaceBrowserPanel />);

    const menu = openContextMenu(await screen.findByTestId('take-row'));
    fireEvent.click(within(menu).getByText('Delete Take'));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(screen.getByText('Survivor')).toBeInTheDocument();
    expect(await manager.listTakeIds(project.id)).toContain(takeId);
  });

  it('warns how many takes a project delete will destroy', async () => {
    const project = await manager.createProject('Busy');
    await addTake(project.id, 'One');
    await addTake(project.id, 'Two');
    render(<WorkspaceBrowserPanel />);

    const menu = openContextMenu(await screen.findByRole('button', { name: /Busy/ }));
    fireEvent.click(within(menu).getByText('Delete Project'));

    expect(await screen.findByText(/2 takes will be permanently deleted/)).toBeInTheDocument();
  });

  it('deletes a project and its takes after confirmation', async () => {
    const project = await manager.createProject('Busy');
    await addTake(project.id, 'One');
    render(<WorkspaceBrowserPanel />);

    const menu = openContextMenu(await screen.findByRole('button', { name: /Busy/ }));
    fireEvent.click(within(menu).getByText('Delete Project'));
    fireEvent.click(await screen.findByTestId('dialog-confirm'));

    await waitFor(() => expect(screen.queryByText('Busy')).toBeNull());
    expect(await manager.listProjectIds()).not.toContain(project.id);
  });
});

describe('toolbar', () => {
  it('creates a project', async () => {
    render(<WorkspaceBrowserPanel />);
    fireEvent.click(await screen.findByRole('button', { name: 'New Project' }));

    await waitFor(async () => expect(await manager.listProjectIds()).toHaveLength(1));
    expect(await screen.findByText('Project 1')).toBeInTheDocument();
  });

  it('refresh picks up a take created outside the panel', async () => {
    const project = await manager.createProject('P');
    render(<WorkspaceBrowserPanel />);
    await screen.findByText('P');

    await addTake(project.id, 'Added Later');
    fireEvent.click(screen.getByRole('button', { name: 'Refresh workspace' }));

    expect(await screen.findByText('Added Later')).toBeInTheDocument();
  });
});
