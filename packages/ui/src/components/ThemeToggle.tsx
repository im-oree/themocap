import { useThemeStore, type ThemeChoice } from '../theme';
import { cn } from '../cn';
import { MoonIcon, SunIcon, SystemIcon } from '../icons';

const OPTIONS: { value: ThemeChoice; label: string; icon: JSX.Element }[] = [
  { value: 'light', label: 'Light', icon: <SunIcon /> },
  { value: 'dark', label: 'Dark', icon: <MoonIcon /> },
  { value: 'system', label: 'System', icon: <SystemIcon /> },
];

/** Segmented control: Light / Dark / System. Arrow keys move between options. */
export function ThemeToggle({ className }: { className?: string }) {
  const theme = useThemeStore((s) => s.theme);
  const setTheme = useThemeStore((s) => s.setTheme);

  return (
    <div
      role="radiogroup"
      aria-label="Color theme"
      className={cn(
        'inline-flex items-center gap-0.5 rounded-xl p-0.5',
        'bg-black/[0.06] dark:bg-white/[0.1]',
        className,
      )}
    >
      {OPTIONS.map((opt) => {
        const selected = theme === opt.value;
        return (
          <button
            key={opt.value}
            type="button"
            role="radio"
            aria-checked={selected}
            aria-label={`${opt.label} theme`}
            title={`${opt.label} theme`}
            onClick={() => setTheme(opt.value)}
            className={cn(
              'inline-flex h-8 w-9 items-center justify-center rounded-[10px]',
              'transition-all duration-180 ease-apple-out',
              selected
                ? 'bg-white text-accent shadow-sm dark:bg-white/20 dark:text-white'
                : 'text-content-light-secondary hover:text-content-light-primary dark:text-content-dark-secondary dark:hover:text-content-dark-primary',
            )}
          >
            {opt.icon}
          </button>
        );
      })}
    </div>
  );
}
