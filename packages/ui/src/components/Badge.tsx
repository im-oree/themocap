import type { HTMLAttributes, ReactNode } from 'react';
import { cn } from '../cn';

export type StatusTone = 'neutral' | 'success' | 'warning' | 'danger' | 'accent';

const toneDot: Record<StatusTone, string> = {
  neutral: 'bg-neutral-400',
  success: 'bg-success',
  warning: 'bg-warning',
  danger: 'bg-danger',
  accent: 'bg-accent',
};

const toneBadge: Record<StatusTone, string> = {
  neutral:
    'bg-black/[0.06] text-content-light-secondary dark:bg-white/[0.1] dark:text-content-dark-secondary',
  success: 'bg-success/15 text-[#1f8f3d] dark:text-success',
  warning: 'bg-warning/20 text-[#8a6d00] dark:text-warning',
  danger: 'bg-danger/15 text-danger',
  accent: 'bg-accent/15 text-accent',
};

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  tone?: StatusTone;
  children: ReactNode;
}

export function Badge({ tone = 'neutral', className, children, ...rest }: BadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium',
        toneBadge[tone],
        className,
      )}
      {...rest}
    >
      {children}
    </span>
  );
}

export interface StatusDotProps {
  tone?: StatusTone;
  /** Accessible label, e.g. "Offline readiness: unknown". */
  label: string;
  pulse?: boolean;
  className?: string;
}

export function StatusDot({ tone = 'neutral', label, pulse, className }: StatusDotProps) {
  return (
    <span className={cn('inline-flex items-center gap-2', className)} title={label}>
      <span
        aria-hidden="true"
        className={cn('h-2 w-2 rounded-full', toneDot[tone], pulse && 'animate-pulse')}
      />
      <span className="sr-only">{label}</span>
    </span>
  );
}
