import { cn } from '../cn';

export interface SpinnerProps {
  /** Pixel size of the square spinner. */
  size?: number;
  className?: string;
  /** Announced to assistive tech; omit only when a sibling already labels it. */
  label?: string;
}

/**
 * Indeterminate activity indicator.
 *
 * Drawn as a rotating SVG arc rather than a border trick so it stays crisp at
 * any size and inherits `currentColor`. Honours reduced-motion by falling back
 * to a static ring — a spinner is decoration, not information.
 */
export function Spinner({ size = 16, className, label = 'Loading' }: SpinnerProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      role="status"
      aria-label={label}
      className={cn('animate-spin motion-reduce:animate-none', className)}
      fill="none"
    >
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity="0.2" strokeWidth="3" />
      <path
        d="M21 12a9 9 0 0 0-9-9"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinecap="round"
      />
    </svg>
  );
}
