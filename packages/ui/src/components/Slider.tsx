import { useId, type InputHTMLAttributes } from 'react';
import { cn } from '../cn';

export interface SliderProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> {
  label: string;
  /** Formatted value shown at the right of the label row. */
  displayValue?: string;
  hideLabel?: boolean;
}

/**
 * Styled native range input — keyboard accessible for free. Visual shell only in
 * Document 1; heavy wiring arrives with the editor tools in Document 3+.
 */
export function Slider({ label, displayValue, hideLabel, className, ...rest }: SliderProps) {
  const id = useId();
  return (
    <div className={cn('w-full', className)}>
      <div className={cn('mb-1.5 flex items-baseline justify-between', hideLabel && 'sr-only')}>
        <label htmlFor={id} className="text-[13px] font-medium">
          {label}
        </label>
        {displayValue !== undefined && (
          <span className="font-mono text-xs text-content-light-secondary dark:text-content-dark-secondary">
            {displayValue}
          </span>
        )}
      </div>
      <input
        id={id}
        type="range"
        aria-label={hideLabel ? label : undefined}
        className={cn(
          'h-11 w-full cursor-pointer appearance-none bg-transparent',
          '[&::-webkit-slider-runnable-track]:h-1.5 [&::-webkit-slider-runnable-track]:rounded-full',
          '[&::-webkit-slider-runnable-track]:bg-black/10 dark:[&::-webkit-slider-runnable-track]:bg-white/15',
          '[&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:h-5 [&::-webkit-slider-thumb]:w-5',
          '[&::-webkit-slider-thumb]:-mt-[7px] [&::-webkit-slider-thumb]:rounded-full',
          '[&::-webkit-slider-thumb]:bg-white [&::-webkit-slider-thumb]:shadow-md',
          '[&::-webkit-slider-thumb]:border [&::-webkit-slider-thumb]:border-black/10',
          '[&::-moz-range-track]:h-1.5 [&::-moz-range-track]:rounded-full [&::-moz-range-track]:bg-black/10',
          '[&::-moz-range-thumb]:h-5 [&::-moz-range-thumb]:w-5 [&::-moz-range-thumb]:rounded-full',
          '[&::-moz-range-thumb]:border-0 [&::-moz-range-thumb]:bg-white [&::-moz-range-thumb]:shadow-md',
          'disabled:opacity-40',
        )}
        {...rest}
      />
    </div>
  );
}
