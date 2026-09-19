import type { HTMLAttributes, ReactNode } from 'react';
import { cn } from '../cn';

export interface ToolbarProps extends HTMLAttributes<HTMLElement> {
  leading?: ReactNode;
  center?: ReactNode;
  trailing?: ReactNode;
  /** Marks the bar as an Electron drag region (no-op in the browser). */
  draggableRegion?: boolean;
}

/** Top app bar with translucent material, matching macOS toolbars. */
export function Toolbar({
  leading,
  center,
  trailing,
  draggableRegion = true,
  className,
  ...rest
}: ToolbarProps) {
  return (
    <header
      className={cn(
        'sticky top-0 z-40 flex h-14 shrink-0 items-center gap-3 px-4',
        'border-b border-hairline-light bg-white/70 backdrop-blur-xl',
        'dark:border-hairline-dark dark:bg-surface-dark-elevated/70',
        draggableRegion && 'app-region-drag',
        className,
      )}
      {...rest}
    >
      <div className="app-region-no-drag flex items-center gap-2">{leading}</div>
      <div className="flex min-w-0 flex-1 items-center justify-center">{center}</div>
      <div className="app-region-no-drag flex items-center gap-1.5">{trailing}</div>
    </header>
  );
}
