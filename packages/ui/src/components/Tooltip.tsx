import { useId, useState, type ReactElement, type ReactNode } from 'react';
import { cn } from '../cn';

export interface TooltipProps {
  content: ReactNode;
  side?: 'top' | 'bottom' | 'right';
  children: ReactElement;
}

/**
 * Lightweight tooltip: shows on hover *and* keyboard focus, and is exposed to
 * assistive tech via aria-describedby.
 */
export function Tooltip({ content, side = 'top', children }: TooltipProps) {
  const [open, setOpen] = useState(false);
  const id = useId();

  const position =
    side === 'top'
      ? 'bottom-full left-1/2 -translate-x-1/2 mb-2'
      : side === 'bottom'
        ? 'top-full left-1/2 -translate-x-1/2 mt-2'
        : 'left-full top-1/2 -translate-y-1/2 ml-2';

  return (
    <span
      className="relative inline-flex"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
      onFocusCapture={() => setOpen(true)}
      onBlurCapture={() => setOpen(false)}
    >
      <span aria-describedby={open ? id : undefined} className="inline-flex">
        {children}
      </span>
      {open && (
        <span
          role="tooltip"
          id={id}
          className={cn(
            'pointer-events-none absolute z-50 whitespace-nowrap rounded-lg px-2.5 py-1.5',
            'text-xs font-medium shadow-panel animate-fade-in',
            'bg-neutral-900/90 text-white backdrop-blur-sm',
            'dark:bg-white/90 dark:text-neutral-900',
            position,
          )}
        >
          {content}
        </span>
      )}
    </span>
  );
}
