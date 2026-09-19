import type { ReactNode } from 'react';
import { cn } from '../cn';
import { Tooltip } from './Tooltip';

export interface SidebarItem {
  id: string;
  label: string;
  icon: ReactNode;
  disabled?: boolean;
  /** Shown in a tooltip; used for the "coming soon" affordance in Document 1. */
  hint?: string;
}

export interface SidebarProps {
  items: SidebarItem[];
  activeId?: string;
  collapsed: boolean;
  onSelect?: (id: string) => void;
  footer?: ReactNode;
  className?: string;
}

/** Collapsible nav rail with an animated width transition. */
export function Sidebar({ items, activeId, collapsed, onSelect, footer, className }: SidebarProps) {
  return (
    <nav
      aria-label="Primary"
      data-collapsed={collapsed}
      className={cn(
        'flex shrink-0 flex-col justify-between overflow-hidden',
        'border-r border-hairline-light bg-white/50 backdrop-blur-xl',
        'dark:border-hairline-dark dark:bg-surface-dark-elevated/50',
        'transition-[width] duration-220 ease-apple-out',
        collapsed ? 'w-[68px]' : 'w-56',
        className,
      )}
    >
      <ul className="flex flex-col gap-1 p-3">
        {items.map((item) => {
          const button = (
            <button
              type="button"
              disabled={item.disabled}
              aria-current={activeId === item.id ? 'page' : undefined}
              onClick={() => onSelect?.(item.id)}
              className={cn(
                'flex h-11 w-full items-center gap-3 rounded-xl px-3 text-sm font-medium',
                'transition-colors duration-180 ease-apple-out',
                'hover:bg-black/[0.06] dark:hover:bg-white/[0.1]',
                'disabled:pointer-events-none disabled:opacity-40',
                activeId === item.id && 'bg-accent/15 text-accent',
                collapsed && 'justify-center px-0',
              )}
            >
              <span aria-hidden="true" className="shrink-0">
                {item.icon}
              </span>
              {!collapsed && <span className="truncate">{item.label}</span>}
              {collapsed && <span className="sr-only">{item.label}</span>}
            </button>
          );

          return (
            <li key={item.id}>
              {item.hint ? (
                // Disabled buttons don't emit pointer events, so wrap for hover/focus.
                <Tooltip content={item.hint} side="right">
                  <span className="block w-full">{button}</span>
                </Tooltip>
              ) : (
                button
              )}
            </li>
          );
        })}
      </ul>
      {footer && <div className="p-3">{footer}</div>}
    </nav>
  );
}
