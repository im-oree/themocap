/**
 * Modal dialog, and the prompt/confirm pair built on it.
 *
 * Exists because Document 3 §6.2 forbids `window.confirm` for destructive
 * actions. That is not only a styling preference: native dialogs block the main
 * thread, cannot be tested without stubbing a global, cannot show the context a
 * delete needs ("this take has a refined pass"), and on some platforms are
 * suppressed entirely after repeated use — which would silently turn "Delete"
 * into a no-op.
 *
 * Focus handling is deliberate rather than delegated to a library: the dialog
 * traps Tab, restores focus to whatever opened it, and closes on Escape. Those
 * three behaviours are what make a modal usable by keyboard, and skipping any
 * one of them strands the user inside it.
 */

import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from 'react';

import { cn } from '../cn';
import { Button } from './Button';

export interface DialogProps {
  open: boolean;
  title: string;
  description?: ReactNode;
  children?: ReactNode;
  /** Label for the confirming action. */
  confirmLabel?: string;
  cancelLabel?: string;
  /** Renders the confirm button in the destructive style. */
  destructive?: boolean;
  confirmDisabled?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

const FOCUSABLE =
  'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [href], [tabindex]:not([tabindex="-1"])';

export function Dialog({
  open,
  title,
  description,
  children,
  confirmLabel = 'OK',
  cancelLabel = 'Cancel',
  destructive = false,
  confirmDisabled = false,
  onConfirm,
  onCancel,
}: DialogProps) {
  const panelRef = useRef<HTMLDivElement | null>(null);
  const restoreRef = useRef<HTMLElement | null>(null);
  const titleId = useId();
  const descriptionId = useId();

  // Remember what had focus so it can be restored on close. Without this,
  // dismissing a dialog dumps focus on <body> and keyboard users lose their place.
  useEffect(() => {
    if (!open) return;
    restoreRef.current = document.activeElement as HTMLElement | null;
    const first = panelRef.current?.querySelector<HTMLElement>(FOCUSABLE);
    first?.focus();
    return () => restoreRef.current?.focus?.();
  }, [open]);

  const onKeyDown = useCallback(
    (event: React.KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        onCancel();
        return;
      }
      if (event.key !== 'Tab') return;

      // Trap Tab inside the dialog by wrapping at the ends.
      const focusable = Array.from(
        panelRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? [],
      );
      if (focusable.length === 0) return;
      const first = focusable[0]!;
      const last = focusable[focusable.length - 1]!;
      const active = document.activeElement;

      if (event.shiftKey && active === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    },
    [onCancel],
  );

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center bg-black/40 p-4"
      // A click on the backdrop cancels, matching every native pattern. The
      // check keeps clicks that bubble from inside the panel from closing it.
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onCancel();
      }}
      onKeyDown={onKeyDown}
      // Presentational scrim: it carries the Escape/Tab handlers for the modal
      // beneath it but is not itself an interactive control.
      role="presentation"
      data-testid="dialog-backdrop"
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descriptionId : undefined}
        className="w-full max-w-[380px] rounded-2xl border border-hairline-light bg-surface-light-elevated p-4 shadow-2xl dark:border-hairline-dark dark:bg-surface-dark-elevated"
      >
        <h2
          id={titleId}
          className="text-[14px] font-semibold tracking-tight text-content-light-primary dark:text-content-dark-primary"
        >
          {title}
        </h2>

        {description && (
          <div
            id={descriptionId}
            className="mt-1.5 text-[12px] leading-relaxed text-content-light-secondary dark:text-content-dark-secondary"
          >
            {description}
          </div>
        )}

        {children && <div className="mt-3">{children}</div>}

        <div className="mt-4 flex justify-end gap-2">
          <Button size="sm" variant="secondary" onClick={onCancel}>
            {cancelLabel}
          </Button>
          <Button
            size="sm"
            variant={destructive ? 'destructive' : 'primary'}
            disabled={confirmDisabled}
            onClick={onConfirm}
            data-testid="dialog-confirm"
          >
            {confirmLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}

export interface PromptDialogProps {
  open: boolean;
  title: string;
  description?: ReactNode;
  label: string;
  initialValue?: string;
  confirmLabel?: string;
  onConfirm: (value: string) => void;
  onCancel: () => void;
}

/** Single-line text prompt — the rename flow. */
export function PromptDialog({
  open,
  title,
  description,
  label,
  initialValue = '',
  confirmLabel = 'Rename',
  onConfirm,
  onCancel,
}: PromptDialogProps) {
  const [value, setValue] = useState(initialValue);
  const inputId = useId();

  // Re-seed whenever the dialog opens: the component stays mounted between
  // uses, so without this the second rename starts with the first one's text.
  useEffect(() => {
    if (open) setValue(initialValue);
  }, [open, initialValue]);

  const trimmed = value.trim();

  const submit = (event?: FormEvent) => {
    event?.preventDefault();
    if (trimmed.length === 0) return;
    onConfirm(trimmed);
  };

  return (
    <Dialog
      open={open}
      title={title}
      description={description}
      confirmLabel={confirmLabel}
      confirmDisabled={trimmed.length === 0}
      onConfirm={() => submit()}
      onCancel={onCancel}
    >
      <form onSubmit={submit}>
        <label
          htmlFor={inputId}
          className="mb-1 block text-[11px] font-medium text-content-light-secondary dark:text-content-dark-secondary"
        >
          {label}
        </label>
        <input
          id={inputId}
          value={value}
          onChange={(event) => setValue(event.target.value)}
          className={cn(
            'w-full rounded-lg border border-hairline-light bg-surface-light px-2 py-1.5 text-[13px]',
            'text-content-light-primary outline-none focus:border-accent',
            'dark:border-hairline-dark dark:bg-surface-dark dark:text-content-dark-primary',
          )}
          data-testid="dialog-input"
        />
      </form>
    </Dialog>
  );
}
