import type { HTMLAttributes, ReactNode } from 'react';
import { cn } from '../cn';

// `title` is widened from the DOM's string-only attribute to full ReactNode, so
// it is omitted from the base props rather than extended.
export interface PanelProps extends Omit<HTMLAttributes<HTMLDivElement>, 'title'> {
  /** Optional header row rendered above the content with a hairline separator. */
  title?: ReactNode;
  actions?: ReactNode;
  /** Removes the default inner padding (useful for tables/lists). */
  flush?: boolean;
}

/** Translucent, blurred "material" container — the base surface of the app. */
export function Panel({ title, actions, flush, className, children, ...rest }: PanelProps) {
  return (
    <div
      className={cn(
        'rounded-xl2 border bg-white/70 backdrop-blur-xl shadow-panel',
        'border-hairline-light dark:border-hairline-dark',
        'dark:bg-surface-dark-elevated/70 dark:shadow-panel-dark',
        className,
      )}
      {...rest}
    >
      {(title || actions) && (
        <div className="flex items-center justify-between gap-3 border-b border-hairline-light px-5 py-3 dark:border-hairline-dark">
          <h2 className="text-sm font-semibold tracking-tight">{title}</h2>
          {actions ? <div className="flex items-center gap-2">{actions}</div> : null}
        </div>
      )}
      <div className={flush ? undefined : 'p-5'}>{children}</div>
    </div>
  );
}
