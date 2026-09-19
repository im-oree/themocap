import { useEffect } from 'react';
import { create } from 'zustand';
import { cn } from '../cn';
import type { StatusTone } from './Badge';

export interface Toast {
  id: string;
  title: string;
  description?: string;
  tone?: StatusTone;
  /** Milliseconds before auto-dismiss; 0 keeps it until dismissed. */
  duration?: number;
}

interface ToastState {
  toasts: Toast[];
  push: (toast: Omit<Toast, 'id'>) => string;
  dismiss: (id: string) => void;
}

export const useToastStore = create<ToastState>((set) => ({
  toasts: [],
  push: (toast) => {
    const id = Math.random().toString(36).slice(2);
    set((s) => ({ toasts: [...s.toasts, { id, duration: 4000, ...toast }] }));
    return id;
  },
  dismiss: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
}));

export const toast = (t: Omit<Toast, 'id'>) => useToastStore.getState().push(t);

const toneBar: Record<StatusTone, string> = {
  neutral: 'bg-neutral-400',
  success: 'bg-success',
  warning: 'bg-warning',
  danger: 'bg-danger',
  accent: 'bg-accent',
};

function ToastCard({ item }: { item: Toast }) {
  const dismiss = useToastStore((s) => s.dismiss);

  useEffect(() => {
    if (!item.duration) return;
    const timer = setTimeout(() => dismiss(item.id), item.duration);
    return () => clearTimeout(timer);
  }, [item.id, item.duration, dismiss]);

  return (
    <div
      className={cn(
        'pointer-events-auto flex w-80 gap-3 overflow-hidden rounded-xl2 p-3 pl-0',
        'border border-hairline-light bg-white/85 shadow-panel backdrop-blur-xl animate-fade-in',
        'dark:border-hairline-dark dark:bg-surface-dark-elevated/85 dark:shadow-panel-dark',
      )}
    >
      <span
        aria-hidden="true"
        className={cn('w-1 shrink-0 rounded-r', toneBar[item.tone ?? 'neutral'])}
      />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold">{item.title}</p>
        {item.description && (
          <p className="mt-0.5 text-xs text-content-light-secondary dark:text-content-dark-secondary">
            {item.description}
          </p>
        )}
      </div>
      <button
        type="button"
        onClick={() => dismiss(item.id)}
        aria-label={`Dismiss ${item.title}`}
        className="h-6 w-6 shrink-0 rounded-md text-content-light-secondary hover:bg-black/[0.06] dark:text-content-dark-secondary dark:hover:bg-white/[0.1]"
      >
        ×
      </button>
    </div>
  );
}

/** Mount once near the app root. */
export function Toaster() {
  const toasts = useToastStore((s) => s.toasts);
  return (
    <div
      aria-live="polite"
      aria-atomic="false"
      className="pointer-events-none fixed bottom-12 right-4 z-[100] flex flex-col gap-2"
    >
      {toasts.map((t) => (
        <ToastCard key={t.id} item={t} />
      ))}
    </div>
  );
}
