import { forwardRef, type ButtonHTMLAttributes } from 'react';
import { cn } from '../cn';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'destructive';
export type ButtonSize = 'sm' | 'md' | 'lg';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  fullWidth?: boolean;
}

const base =
  'inline-flex items-center justify-center gap-2 rounded-xl font-medium select-none ' +
  'transition-[background-color,transform,opacity] duration-180 ease-apple-out ' +
  'active:scale-[0.98] disabled:pointer-events-none disabled:opacity-40';

const variants: Record<ButtonVariant, string> = {
  primary: 'bg-accent text-white hover:bg-accent-hover shadow-sm',
  secondary:
    'bg-black/[0.06] text-content-light-primary hover:bg-black/[0.1] ' +
    'dark:bg-white/[0.12] dark:text-content-dark-primary dark:hover:bg-white/[0.18]',
  ghost:
    'bg-transparent text-content-light-primary hover:bg-black/[0.06] ' +
    'dark:text-content-dark-primary dark:hover:bg-white/[0.1]',
  destructive: 'bg-danger text-white hover:brightness-110 shadow-sm',
};

// Heights honour the 44px minimum hit target at md/lg; sm keeps 32px visual with
// padding-driven touch slop for dense internal tools.
const sizes: Record<ButtonSize, string> = {
  sm: 'h-8 px-3 text-[13px]',
  md: 'h-11 px-4 text-sm',
  lg: 'h-12 px-6 text-base',
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'secondary', size = 'md', fullWidth, className, type = 'button', ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      className={cn(base, variants[variant], sizes[size], fullWidth && 'w-full', className)}
      {...rest}
    />
  );
});
