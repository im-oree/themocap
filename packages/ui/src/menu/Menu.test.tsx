/**
 * Keyboard-model tests for the menu bar.
 *
 * A menu bar that only works with a mouse is a menu bar that fails for keyboard
 * and screen-reader users, and the WAI-ARIA menu pattern is fiddly enough that
 * it is worth pinning the behaviour rather than trusting it stays correct.
 */

import { describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { Menu, MenuBar } from './Menu';
import type { MenuItemSpec } from './Menu';

function items(onSelect = vi.fn()): MenuItemSpec[] {
  return [
    { kind: 'item', id: 'new', label: 'New', onSelect },
    { kind: 'item', id: 'open', label: 'Open', disabled: true },
    { kind: 'separator', id: 'sep' },
    { kind: 'item', id: 'save', label: 'Save', onSelect },
    { kind: 'checkbox', id: 'grid', label: 'Grid', checked: true, onSelect },
  ];
}

/**
 * Menu triggers carry `role="menuitem"` (the ARIA menubar pattern), which is the
 * same role the popup items use — so queries have to be scoped, or every lookup
 * is ambiguous.
 */
function trigger(id: string): HTMLElement {
  const element = document.querySelector<HTMLElement>(`[data-menu-trigger="${id}"]`);
  if (!element) throw new Error(`No menu trigger "${id}"`);
  return element;
}

/** Queries scoped to the open popup rather than the whole document. */
function inMenu() {
  return within(screen.getByRole('menu'));
}

/**
 * The open menu keeps DOM focus on the list and moves a *virtual* cursor with
 * `aria-activedescendant`, so "which item is highlighted" is read from that
 * attribute rather than from `document.activeElement`.
 */
function expectHighlighted(name: string | RegExp, role = 'menuitem') {
  const list = screen.getByRole('menu');
  expect(list).toHaveFocus();
  const item = within(list).getByRole(role, { name });
  expect(list).toHaveAttribute('aria-activedescendant', item.id);
}

function renderBar(onSelect = vi.fn()) {
  render(
    <MenuBar>
      <Menu id="file" label="File" items={items(onSelect)} />
      <Menu id="view" label="View" items={[{ kind: 'item', id: 'zoom', label: 'Zoom' }]} />
    </MenuBar>,
  );
  return onSelect;
}

describe('MenuBar keyboard model', () => {
  it('opens a menu with Enter and focuses the first enabled item', async () => {
    const user = userEvent.setup();
    renderBar();

    await user.tab();
    expect(trigger('file')).toHaveFocus();

    await user.keyboard('{Enter}');
    expectHighlighted('New');
  });

  it('skips disabled items and separators when arrowing down', async () => {
    const user = userEvent.setup();
    renderBar();

    await user.tab();
    await user.keyboard('{Enter}{ArrowDown}');

    // 'Open' is disabled and the separator is not focusable, so Save is next.
    expectHighlighted('Save');
  });

  it('wraps from the last item back to the first', async () => {
    const user = userEvent.setup();
    renderBar();

    await user.tab();
    await user.keyboard('{Enter}{ArrowUp}');

    // ArrowUp from the first item wraps to the last (the Grid checkbox).
    expectHighlighted(/Grid/, 'menuitemcheckbox');
  });

  it('moves between menus with ArrowRight while one is open', async () => {
    const user = userEvent.setup();
    renderBar();

    await user.tab();
    await user.keyboard('{Enter}{ArrowRight}');

    expectHighlighted('Zoom');
  });

  it('closes on Escape and returns focus to the trigger', async () => {
    const user = userEvent.setup();
    renderBar();

    await user.tab();
    await user.keyboard('{Enter}');
    expect(screen.getByRole('menu')).toBeInTheDocument();

    await user.keyboard('{Escape}');
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    expect(trigger('file')).toHaveFocus();
  });

  it('invokes the handler and closes the menu on Enter', async () => {
    const user = userEvent.setup();
    const onSelect = renderBar();

    await user.tab();
    await user.keyboard('{Enter}{ArrowDown}{Enter}');

    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });

  it('does not invoke disabled items', async () => {
    const user = userEvent.setup();
    const onSelect = renderBar();

    await user.click(trigger('file'));
    await user.click(inMenu().getByRole('menuitem', { name: 'Open' }));

    expect(onSelect).not.toHaveBeenCalled();
  });

  it('exposes checkbox state through aria-checked', async () => {
    const user = userEvent.setup();
    renderBar();

    await user.click(trigger('file'));
    expect(inMenu().getByRole('menuitemcheckbox', { name: /Grid/ })).toHaveAttribute(
      'aria-checked',
      'true',
    );
  });

  it('jumps to an item by typing its first letter', async () => {
    const user = userEvent.setup();
    renderBar();

    await user.tab();
    await user.keyboard('{Enter}s');

    expectHighlighted('Save');
  });
});
