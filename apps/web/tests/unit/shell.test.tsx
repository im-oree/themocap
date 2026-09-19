import { describe, expect, it } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Shell } from '../../src/app/Shell';
import { useAppStore } from '../../src/state/useAppStore';

/**
 * Renders the real shell (not a mock) so layout regressions surface in CI without
 * needing a browser. The Playwright suite covers the browser-only assertions
 * (crossOriginIsolated, no-flash theming, network guard).
 */
describe('app shell', () => {
  it('renders header, sidebar, main content and the status bar', async () => {
    render(<Shell />);

    expect(screen.getByRole('heading', { name: 'Foundation ready' })).toBeInTheDocument();
    expect(screen.getByRole('navigation', { name: 'Primary' })).toBeInTheDocument();
    expect(screen.getByRole('radiogroup', { name: 'Color theme' })).toBeInTheDocument();
    expect(screen.getByTestId('frame-counter')).toHaveTextContent('Frames: —');
  });

  it('lists every future section as a disabled nav item', () => {
    render(<Shell />);
    const nav = within(screen.getByRole('navigation', { name: 'Primary' }));
    for (const label of ['Live', 'Takes', 'Editor', 'Export', 'Settings']) {
      expect(nav.getByRole('button', { name: label })).toBeDisabled();
    }
  });

  it('collapses and expands the sidebar, persisting the choice', async () => {
    useAppStore.getState().setSidebarCollapsed(false);
    render(<Shell />);
    const nav = screen.getByRole('navigation', { name: 'Primary' });
    expect(nav).toHaveAttribute('data-collapsed', 'false');

    await userEvent.click(screen.getByRole('button', { name: 'Collapse sidebar' }));
    expect(nav).toHaveAttribute('data-collapsed', 'true');
    expect(localStorage.getItem('wms-sidebar-collapsed')).toBe('1');

    await userEvent.click(screen.getByRole('button', { name: 'Expand sidebar' }));
    expect(nav).toHaveAttribute('data-collapsed', 'false');
  });

  it('shows the offline-readiness indicator', () => {
    render(<Shell />);
    expect(screen.getByTitle(/Offline readiness/)).toBeInTheDocument();
  });

  it('reports the WASM probe failure in diagnostics rather than crashing', async () => {
    // In this environment the crate may not be built; either way the shell must
    // render and the diagnostics panel must reach a terminal state.
    render(<Shell />);
    const diagnostics = screen.getByTestId('diagnostics');
    await waitFor(() => {
      expect(diagnostics).toHaveTextContent(/crossOriginIsolated/);
    });
    expect(diagnostics).toHaveTextContent(/WASM SIMD/);
  });
});
