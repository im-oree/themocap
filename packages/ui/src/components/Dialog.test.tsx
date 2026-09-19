/**
 * Dialog: the replacement for `window.confirm` in destructive flows.
 *
 * The focus behaviours are tested as carefully as the callbacks, because a
 * modal that traps a keyboard user is a worse bug than one that looks wrong.
 */

import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

import { Dialog, PromptDialog } from './Dialog';

describe('Dialog', () => {
  it('renders nothing when closed', () => {
    render(<Dialog open={false} title="Delete?" onConfirm={vi.fn()} onCancel={vi.fn()} />);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('exposes the accessible modal contract', () => {
    render(
      <Dialog open title="Delete Take?" description="Gone forever." onConfirm={vi.fn()} onCancel={vi.fn()} />,
    );
    const dialog = screen.getByRole('dialog');

    expect(dialog).toHaveAttribute('aria-modal', 'true');
    // A modal without an accessible name is unannounced by screen readers.
    expect(dialog).toHaveAccessibleName('Delete Take?');
    expect(dialog).toHaveAccessibleDescription('Gone forever.');
  });

  it('calls onConfirm and onCancel from the buttons', () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    render(<Dialog open title="T" confirmLabel="Delete" onConfirm={onConfirm} onCancel={onCancel} />);

    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    expect(onConfirm).toHaveBeenCalledOnce();

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onCancel).toHaveBeenCalledOnce();
  });

  it('cancels on Escape', () => {
    const onCancel = vi.fn();
    render(<Dialog open title="T" onConfirm={vi.fn()} onCancel={onCancel} />);

    fireEvent.keyDown(screen.getByTestId('dialog-backdrop'), { key: 'Escape' });
    expect(onCancel).toHaveBeenCalledOnce();
  });

  it('cancels on a backdrop click but not on a click inside the panel', () => {
    const onCancel = vi.fn();
    render(<Dialog open title="T" onConfirm={vi.fn()} onCancel={onCancel} />);

    fireEvent.mouseDown(screen.getByRole('dialog'));
    expect(onCancel).not.toHaveBeenCalled();

    fireEvent.mouseDown(screen.getByTestId('dialog-backdrop'));
    expect(onCancel).toHaveBeenCalledOnce();
  });

  it('moves focus into the dialog when opened', () => {
    render(<Dialog open title="T" onConfirm={vi.fn()} onCancel={vi.fn()} />);
    expect(screen.getByRole('dialog').contains(document.activeElement)).toBe(true);
  });

  it('restores focus to the opener when closed', () => {
    const opener = document.createElement('button');
    document.body.appendChild(opener);
    opener.focus();
    expect(document.activeElement).toBe(opener);

    const { rerender } = render(<Dialog open title="T" onConfirm={vi.fn()} onCancel={vi.fn()} />);
    rerender(<Dialog open={false} title="T" onConfirm={vi.fn()} onCancel={vi.fn()} />);

    // Without this, dismissing strands focus on <body>.
    expect(document.activeElement).toBe(opener);
    opener.remove();
  });

  it('wraps Tab at the end of the dialog', () => {
    render(<Dialog open title="T" confirmLabel="Go" onConfirm={vi.fn()} onCancel={vi.fn()} />);
    const cancel = screen.getByRole('button', { name: 'Cancel' });
    const confirm = screen.getByRole('button', { name: 'Go' });

    confirm.focus();
    fireEvent.keyDown(screen.getByTestId('dialog-backdrop'), { key: 'Tab' });
    expect(document.activeElement).toBe(cancel);

    fireEvent.keyDown(screen.getByTestId('dialog-backdrop'), { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(confirm);
  });

  it('honours confirmDisabled', () => {
    const onConfirm = vi.fn();
    render(
      <Dialog open title="T" confirmLabel="Go" confirmDisabled onConfirm={onConfirm} onCancel={vi.fn()} />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Go' }));
    expect(onConfirm).not.toHaveBeenCalled();
  });
});

describe('PromptDialog', () => {
  const setup = (onConfirm = vi.fn(), initialValue = 'Take 1') => {
    const utils = render(
      <PromptDialog
        open
        title="Rename Take"
        label="Name"
        initialValue={initialValue}
        onConfirm={onConfirm}
        onCancel={vi.fn()}
      />,
    );
    return { ...utils, onConfirm, input: screen.getByTestId('dialog-input') as HTMLInputElement };
  };

  it('seeds the input with the current name', () => {
    expect(setup().input.value).toBe('Take 1');
  });

  it('confirms with the edited value', () => {
    const { input, onConfirm } = setup();
    fireEvent.change(input, { target: { value: 'Best Take' } });
    fireEvent.click(screen.getByRole('button', { name: 'Rename' }));

    expect(onConfirm).toHaveBeenCalledWith('Best Take');
  });

  it('trims surrounding whitespace', () => {
    const { input, onConfirm } = setup();
    fireEvent.change(input, { target: { value: '  Padded  ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Rename' }));

    expect(onConfirm).toHaveBeenCalledWith('Padded');
  });

  it('refuses an empty name', () => {
    const { input, onConfirm } = setup();
    fireEvent.change(input, { target: { value: '   ' } });

    expect(screen.getByRole('button', { name: 'Rename' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Rename' }));
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('submits on Enter', () => {
    const { input, onConfirm } = setup();
    fireEvent.change(input, { target: { value: 'Via Enter' } });
    fireEvent.submit(input.closest('form')!);

    expect(onConfirm).toHaveBeenCalledWith('Via Enter');
  });

  it('re-seeds when reopened with a different name', () => {
    const onConfirm = vi.fn();
    const { rerender } = render(
      <PromptDialog
        open={false}
        title="Rename"
        label="Name"
        initialValue="First"
        onConfirm={onConfirm}
        onCancel={vi.fn()}
      />,
    );
    rerender(
      <PromptDialog
        open
        title="Rename"
        label="Name"
        initialValue="Second"
        onConfirm={onConfirm}
        onCancel={vi.fn()}
      />,
    );

    // The component stays mounted between uses; stale text here would mean
    // renaming take B pre-filled with take A's name.
    expect((screen.getByTestId('dialog-input') as HTMLInputElement).value).toBe('Second');
  });
});

describe('PromptDialog focus', () => {
  it('focuses the text input on open, not the first button', () => {
    render(
      <PromptDialog
        open
        title="Rename"
        label="Name"
        initialValue="Take 1"
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    // The input precedes the buttons in DOM order, so the Dialog's generic
    // "focus the first focusable child" lands on it without needing autoFocus
    // (which eslint-plugin-jsx-a11y rightly rejects).
    expect(document.activeElement).toBe(screen.getByTestId('dialog-input'));
  });
});
