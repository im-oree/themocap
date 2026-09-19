/**
 * Right-click context menu (§B.4).
 *
 * Shares `MenuItemSpec` with the menu bar so an action can be offered in both
 * places without being described twice.
 *
 * Two behaviours worth noting:
 *
 * - **Viewport flipping.** The menu is positioned at the pointer, then nudged
 *   back inside the window if it would overflow. Without this, right-clicking
 *   near the bottom of a dock panel opens a menu you cannot reach.
 * - **Rendered in place, not in a portal.** Dockview panels do not clip their
 *   content and our menu is `position: fixed`, so a portal buys nothing and
 *   would complicate focus return.
 */

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';

import { cn } from '../cn';
import type { MenuItemSpec } from './Menu';

export interface ContextMenuState {
  x: number;
  y: number;
  items: MenuItemSpec[];
}

export interface ContextMenuProps {
  state: ContextMenuState | null;
  onClose: () => void;
}

export function ContextMenu({ state, onClose }: ContextMenuProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState<{ left: number; top: number } | null>(null);
  const [activeIndex, setActiveIndex] = useState(-1);

  // Measure after mount, then clamp into the viewport before the first paint the
  // user sees — useLayoutEffect so there is no visible jump.
  useLayoutEffect(() => {
    if (!state) {
      setPosition(null);
      return;
    }
    const element = ref.current;
    if (!element) return;
    const { width, height } = element.getBoundingClientRect();
    const margin = 8;
    const left = Math.min(state.x, window.innerWidth - width - margin);
    const top = Math.min(state.y, window.innerHeight - height - margin);
    setPosition({ left: Math.max(margin, left), top: Math.max(margin, top) });
    setActiveIndex(-1);
  }, [state]);

  useEffect(() => {
    if (!state) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!ref.current?.contains(event.target as Node)) onClose();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    // A scroll or resize invalidates the anchor position entirely; closing is
    // more predictable than trying to follow the element.
    const onScrollOrResize = () => onClose();

    document.addEventListener('pointerdown', onPointerDown, true);
    document.addEventListener('keydown', onKeyDown);
    window.addEventListener('resize', onScrollOrResize);
    window.addEventListener('scroll', onScrollOrResize, true);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true);
      document.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('resize', onScrollOrResize);
      window.removeEventListener('scroll', onScrollOrResize, true);
    };
  }, [state, onClose]);

  const focusable = (state?.items ?? [])
    .map((item, index) => (item.kind !== 'separator' && !item.disabled ? index : -1))
    .filter((index) => index >= 0);

  const move = useCallback(
    (delta: 1 | -1) => {
      if (focusable.length === 0) return;
      const at = focusable.indexOf(activeIndex);
      const next =
        at === -1
          ? delta === 1
            ? 0
            : focusable.length - 1
          : (at + delta + focusable.length) % focusable.length;
      setActiveIndex(focusable[next]!);
    },
    [activeIndex, focusable],
  );

  if (!state) return null;

  return (
    <div
      ref={ref}
      role="menu"
      tabIndex={-1}
      /* eslint-disable-next-line jsx-a11y/no-autofocus -- moving focus into an
             opened menu is required menu-pattern behaviour (WAI-ARIA APG); without
             it keyboard users cannot reach the items at all. */
            autoFocus
      onKeyDown={(event) => {
        if (event.key === 'ArrowDown') {
          event.preventDefault();
          move(1);
        } else if (event.key === 'ArrowUp') {
          event.preventDefault();
          move(-1);
        } else if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          const item = state.items[activeIndex];
          if (item && item.kind !== 'separator' && item.kind !== 'submenu' && !item.disabled) {
            item.onSelect?.();
            onClose();
          }
        }
      }}
      style={{
        left: position?.left ?? state.x,
        top: position?.top ?? state.y,
        // Keep it invisible until clamped, so it never flashes off-screen.
        visibility: position ? 'visible' : 'hidden',
      }}
      className={cn(
        'fixed z-[60] min-w-[184px] animate-fade-in',
        'rounded-xl border border-hairline-light bg-white/92 p-1 shadow-panel backdrop-blur-xl',
        'dark:border-hairline-dark dark:bg-surface-dark-elevated/95 dark:shadow-panel-dark',
      )}
    >
      {state.items.map((item, index) => {
        if (item.kind === 'separator') {
          return (
            <div
              key={item.id}
              role="separator"
              className="my-1 h-px bg-hairline-light dark:bg-hairline-dark"
            />
          );
        }
        if (item.kind === 'submenu') return null;
        const active = index === activeIndex && !item.disabled;
        return (
          <button
            key={item.id}
            type="button"
            role="menuitem"
            disabled={item.disabled}
            title={item.hint}
            onPointerEnter={() => !item.disabled && setActiveIndex(index)}
            onClick={() => {
              item.onSelect?.();
              onClose();
            }}
            className={cn(
              'flex w-full items-center gap-2 rounded-lg px-2 py-[6px] text-left text-[13px]',
              'text-content-light-primary transition-colors duration-180 ease-apple-out dark:text-content-dark-primary',
              active && 'bg-accent text-white',
              item.disabled && 'cursor-not-allowed opacity-40',
            )}
          >
            <span className="flex-1 truncate">{item.label}</span>
            {item.shortcut && (
              <span
                className={cn(
                  'ml-4 font-mono text-[11px]',
                  active ? 'text-white/75' : 'text-content-light-secondary dark:text-content-dark-secondary',
                )}
              >
                {item.shortcut}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

/** Hook wiring an `onContextMenu` handler to a `ContextMenu`. */
export function useContextMenu() {
  const [state, setState] = useState<ContextMenuState | null>(null);

  const open = useCallback((event: { clientX: number; clientY: number; preventDefault: () => void }, items: MenuItemSpec[]) => {
    event.preventDefault();
    setState({ x: event.clientX, y: event.clientY, items });
  }, []);

  const close = useCallback(() => setState(null), []);

  return { state, open, close };
}
