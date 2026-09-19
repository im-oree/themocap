import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Button, IconButton, Panel, Sidebar, ThemeToggle, Tooltip } from '@wms/ui';

describe('design-system primitives', () => {
  it('Button fires clicks and respects disabled', async () => {
    const onClick = vi.fn();
    const { rerender } = render(<Button onClick={onClick}>Run</Button>);
    await userEvent.click(screen.getByRole('button', { name: 'Run' }));
    expect(onClick).toHaveBeenCalledTimes(1);

    rerender(
      <Button onClick={onClick} disabled>
        Run
      </Button>,
    );
    expect(screen.getByRole('button', { name: 'Run' })).toBeDisabled();
  });

  it('IconButton exposes an accessible name for icon-only controls', () => {
    render(<IconButton label="Collapse sidebar" icon={<svg />} />);
    expect(screen.getByRole('button', { name: 'Collapse sidebar' })).toBeTruthy();
  });

  it('Panel renders its heading and children', () => {
    render(<Panel title="Diagnostics">contents</Panel>);
    expect(screen.getByRole('heading', { name: 'Diagnostics' })).toBeTruthy();
    expect(screen.getByText('contents')).toBeTruthy();
  });

  it('Tooltip appears on keyboard focus, not just hover', async () => {
    render(
      <Tooltip content="Coming in Document 2">
        <button type="button">Live</button>
      </Tooltip>,
    );
    expect(screen.queryByRole('tooltip')).toBeNull();
    await userEvent.tab();
    expect(screen.getByRole('tooltip')).toHaveTextContent('Coming in Document 2');
  });

  it('ThemeToggle is a radiogroup with three options', async () => {
    render(<ThemeToggle />);
    const group = screen.getByRole('radiogroup', { name: 'Color theme' });
    expect(group).toBeTruthy();
    const options = screen.getAllByRole('radio');
    expect(options).toHaveLength(3);

    await userEvent.click(screen.getByRole('radio', { name: 'Dark theme' }));
    expect(screen.getByRole('radio', { name: 'Dark theme' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
  });

  it('Sidebar renders nav items and hides labels when collapsed', () => {
    const items = [{ id: 'live', label: 'Live', icon: <svg />, disabled: true }];
    const { rerender } = render(<Sidebar items={items} collapsed={false} />);
    expect(screen.getByRole('navigation', { name: 'Primary' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Live' })).toBeDisabled();

    rerender(<Sidebar items={items} collapsed />);
    // Still accessible by name via the sr-only label.
    expect(screen.getByRole('button', { name: 'Live' })).toBeTruthy();
  });
});
