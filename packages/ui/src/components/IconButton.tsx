import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { cn } from '../cn';

export interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** Required: icon-only controls must expose an accessible name. */
  label: string;
  icon: ReactNode;
  active?: boolean;
}

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { label, icon, active, className, type = 'button', ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      aria-label={label}
      aria-pressed={active}
      title={label}
      className={cn(
        'inline-flex h-11 w-11 items-center justify-center rounded-xl',
        'transition-colors duration-180 ease-apple-out',
        'hover:bg-black/[0.06] dark:hover:bg-white/[0.1]',
        'disabled:pointer-events-none disabled:opacity-40',
        active && 'bg-black/[0.08] dark:bg-white/[0.14]',
        className,
      )}
      {...rest}
    >
      {icon}
    </button>
  );
});
