/**
 * Mount smoke test for the editor shell.
 *
 * Playwright cannot run in this environment (no downloadable browser), so this
 * is the only automated check that the shell actually *constructs* — that
 * `dockview`, the stores, the menu bar and the status bar all initialise without
 * throwing. It is not a substitute for the e2e specs in `tests/e2e/dock.spec.ts`,
 * which cover the behaviour that needs a real layout engine.
 *
 * `RigScene` is mocked: jsdom has no WebGL, and the scene's own geometry is
 * already covered by `rigSkeleton.test.ts`.
 */

import { describe, expect, it, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';

vi.mock('../../src/features/rig/RigScene', () => ({
  RigScene: class {
    applyRestPose(): void {}
    applyPose(): void {}
    setToggles(): void {}
    setSelection(): void {}
    resize(): void {}
    render(): void {}
    dispose(): void {}
    frameAll(): void {}
    frameSelected(): void {}
    snapToView(): void {}
    resetCamera(): void {}
    pickJoint(): null {
      return null;
    }
    pickNavGizmo(): null {
      return null;
    }
    navGizmoRect() {
      return { x: 0, y: 0, width: 0, height: 0 };
    }
    get drawCalls(): number {
      return 0;
    }
  },
}));

import { AppDock } from '../../src/dock/AppDock';

describe('editor shell', () => {
  it('mounts the menu bar, toolbar, dock surfaces and status bar', async () => {
    // `act` wraps the mount so dockview's async `onReady` layout work settles
    // before assertions, rather than leaking into the next test.
    await act(async () => {
      render(<AppDock />);
    });

    expect(screen.getByRole('menubar')).toBeInTheDocument();
    expect(screen.getByTestId('app-toolbar')).toBeInTheDocument();
    expect(screen.getByTestId('status-bar')).toBeInTheDocument();
    expect(screen.getByTestId('workspace-tabs')).toBeInTheDocument();
    expect(screen.getByTestId('workspace-surface-live')).toBeInTheDocument();
  });

  it('exposes the five top-level menus', async () => {
    await act(async () => {
      render(<AppDock />);
    });

    for (const id of ['file', 'edit', 'view', 'panels', 'help']) {
      expect(document.querySelector(`[data-menu-trigger="${id}"]`)).not.toBeNull();
    }
  });

  it('disables Record until a source exists', async () => {
    await act(async () => {
      render(<AppDock />);
    });

    expect(screen.getByTestId('record-button')).toBeDisabled();
  });

  it('marks Live selected and Edit disabled', async () => {
    await act(async () => {
      render(<AppDock />);
    });

    expect(screen.getByTestId('workspace-tab-live')).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByTestId('workspace-tab-edit')).toHaveAttribute('aria-disabled', 'true');
  });
});
