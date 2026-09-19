/**
 * Menu primitives for the application menu bar and context menus.
 *
 * Built from scratch rather than pulled from a headless-UI library: the set of
 * behaviours an editor menu needs is small and well-defined, and the addendum
 * (§A.3) calls for a real always-visible menu bar rather than a generic popover.
 * Owning it also means the keyboard model is exactly the desktop one rather than
 * a web-widget approximation.
 *
 * Keyboard model (matches macOS/Windows menu bars, and §A.9 item 5):
 *
 * - `ArrowRight` / `ArrowLeft` move between top-level menus. When a menu is open,
 *   this closes it and opens the neighbour — the standard "slide along the bar"
 *   behaviour.
 * - `ArrowDown` / `ArrowUp` move between items, skipping disabled and separator
 *   entries, and wrapping at the ends.
 * - `Enter` / `Space` activate; `Escape` closes and returns focus to the trigger.
 * - `Home` / `End` jump to the first/last enabled item.
 * - Typing a letter jumps to the next item starting with it (type-ahead).
 *
 * Accessibility: the bar is a `menubar`, triggers are `menuitem` with
 * `aria-haspopup`/`aria-expanded`, the dropdown is a `menu`, and checkbox items
 * use `menuitemcheckbox` with `aria-checked`, so the Panels menu's open/closed
 * state is announced rather than merely drawn.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from 'react';

import { cn } from '../cn';

export interface MenuBarContextValue {
  openMenuId: string | null;
  setOpenMenuId: (id: string | null) => void;
  /** True once a menu has been opened, so hovering siblings switches menus. */
  hoverArmed: boolean;
  registerMenu: (id: string) => void;
  unregisterMenu: (id: string) => void;
  focusSibling: (currentId: string, delta: 1 | -1) => void;
}

const MenuBarContext = createContext<MenuBarContextValue | null>(null);

export function MenuBar({ children, className }: { children: ReactNode; className?: string }) {
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const order = useRef<string[]>([]);

  const registerMenu = useCallback((id: string) => {
    if (!order.current.includes(id)) order.current.push(id);
  }, []);

  const unregisterMenu = useCallback((id: string) => {
    order.current = order.current.filter((entry) => entry !== id);
  }, []);

  const focusSibling = useCallback((currentId: string, delta: 1 | -1) => {
    const ids = order.current;
    const index = ids.indexOf(currentId);
    if (index === -1) return;
    const next = ids[(index + delta + ids.length) % ids.length];
    if (!next) return;
    const element = document.querySelector<HTMLElement>(`[data-menu-trigger="${next}"]`);
    element?.focus();
    // Only slide the open menu along if one was already open; otherwise merely
    // move focus, which is what a closed menu bar should do.
    setOpenMenuId((current) => (current === null ? null : next));
  }, []);

  const value = useMemo<MenuBarContextValue>(
    () => ({
      openMenuId,
      setOpenMenuId,
      hoverArmed: openMenuId !== null,
      registerMenu,
      unregisterMenu,
      focusSibling,
    }),
    [openMenuId, registerMenu, unregisterMenu, focusSibling],
  );

  return (
    <MenuBarContext.Provider value={value}>
      <div role="menubar" className={cn('flex items-stretch gap-0.5', className)}>
        {children}
      </div>
    </MenuBarContext.Provider>
  );
}

export type MenuItemSpec =
  | {
      kind: 'item';
      id: string;
      label: string;
      shortcut?: string;
      disabled?: boolean;
      /** Shown in a tooltip; used for "Coming in Document N" affordances. */
      hint?: string;
      onSelect?: () => void;
    }
  | {
      kind: 'checkbox';
      id: string;
      label: string;
      checked: boolean;
      shortcut?: string;
      disabled?: boolean;
      hint?: string;
      onSelect?: () => void;
    }
  | { kind: 'separator'; id: string }
  | {
      kind: 'submenu';
      id: string;
      label: string;
      disabled?: boolean;
      items: MenuItemSpec[];
    };

function isFocusable(item: MenuItemSpec): boolean {
  return item.kind !== 'separator' && !item.disabled;
}

export interface MenuProps {
  id: string;
  label: string;
  items: MenuItemSpec[];
  className?: string;
}

/** One top-level menu: a trigger in the bar plus its dropdown. */
export function Menu({ id, label, items, className }: MenuProps) {
  const bar = useContext(MenuBarContext);
  if (!bar) throw new Error('Menu must be rendered inside a MenuBar');

  const { openMenuId, setOpenMenuId, hoverArmed, registerMenu, unregisterMenu, focusSibling } = bar;
  const open = openMenuId === id;
  const triggerRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const [activeIndex, setActiveIndex] = useState<number>(-1);
  const menuId = useId();

  useEffect(() => {
    registerMenu(id);
    return () => unregisterMenu(id);
  }, [id, registerMenu, unregisterMenu]);

  // Close on outside pointer-down and on Escape anywhere.
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (listRef.current?.contains(target) || triggerRef.current?.contains(target)) return;
      setOpenMenuId(null);
    };
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpenMenuId(null);
        triggerRef.current?.focus();
      }
    };
    document.addEventListener('pointerdown', onPointerDown, true);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open, setOpenMenuId]);


  /** DOM id of the highlighted row, or undefined when nothing is highlighted. */
  const activeDescendantId = useMemo(() => {
    const item = items[activeIndex];
    return item && item.kind !== 'separator' ? `${menuId}-${item.id}` : undefined;
  }, [items, activeIndex, menuId]);

  const focusableIndices = useMemo(
    () => items.map((item, index) => (isFocusable(item) ? index : -1)).filter((i) => i >= 0),
    [items],
  );

  useEffect(() => {
    if (!open) {
      setActiveIndex(-1);
      return;
    }
    // Explicit focus rather than `autoFocus`: React's autoFocus is unreliable on
    // non-form elements, and the whole keyboard model depends on this landing.
    listRef.current?.focus();
    // Opening with nothing highlighted leaves the keyboard user stranded — it
    // happens when a menu is opened by *sliding* from a sibling with Arrow keys
    // rather than via this menu's own trigger handler.
    setActiveIndex((current) => (current === -1 ? (focusableIndices[0] ?? -1) : current));
  }, [open, focusableIndices]);

  const moveActive = useCallback(
    (delta: 1 | -1) => {
      if (focusableIndices.length === 0) return;
      const position = focusableIndices.indexOf(activeIndex);
      const nextPosition =
        position === -1
          ? delta === 1
            ? 0
            : focusableIndices.length - 1
          : (position + delta + focusableIndices.length) % focusableIndices.length;
      setActiveIndex(focusableIndices[nextPosition]!);
    },
    [activeIndex, focusableIndices],
  );

  const activate = useCallback(
    (item: MenuItemSpec) => {
      if (item.kind === 'separator' || item.disabled) return;
      if (item.kind === 'submenu') return;
      item.onSelect?.();
      setOpenMenuId(null);
      triggerRef.current?.focus();
    },
    [setOpenMenuId],
  );

  const onTriggerKeyDown = (event: ReactKeyboardEvent<HTMLButtonElement>) => {
    switch (event.key) {
      case 'ArrowRight':
        event.preventDefault();
        focusSibling(id, 1);
        break;
      case 'ArrowLeft':
        event.preventDefault();
        focusSibling(id, -1);
        break;
      case 'ArrowDown':
      case 'Enter':
      case ' ':
        event.preventDefault();
        setOpenMenuId(id);
        setActiveIndex(focusableIndices[0] ?? -1);
        break;
      case 'ArrowUp':
        event.preventDefault();
        setOpenMenuId(id);
        setActiveIndex(focusableIndices[focusableIndices.length - 1] ?? -1);
        break;
      default:
        break;
    }
  };

  const onListKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        moveActive(1);
        break;
      case 'ArrowUp':
        event.preventDefault();
        moveActive(-1);
        break;
      case 'Home':
        event.preventDefault();
        setActiveIndex(focusableIndices[0] ?? -1);
        break;
      case 'End':
        event.preventDefault();
        setActiveIndex(focusableIndices[focusableIndices.length - 1] ?? -1);
        break;
      case 'ArrowRight':
        event.preventDefault();
        focusSibling(id, 1);
        break;
      case 'ArrowLeft':
        event.preventDefault();
        focusSibling(id, -1);
        break;
      case 'Enter':
      case ' ': {
        event.preventDefault();
        const item = items[activeIndex];
        if (item) activate(item);
        break;
      }
      case 'Tab':
        // Tabbing out of an open menu should close it, not leave it orphaned.
        setOpenMenuId(null);
        break;
      default: {
        // Type-ahead: jump to the next item whose label starts with the key.
        if (event.key.length !== 1 || event.metaKey || event.ctrlKey || event.altKey) return;
        const needle = event.key.toLowerCase();
        const ordered = [
          ...focusableIndices.filter((i) => i > activeIndex),
          ...focusableIndices.filter((i) => i <= activeIndex),
        ];
        const match = ordered.find((index) => {
          const item = items[index];
          return (
            item &&
            item.kind !== 'separator' &&
            item.label.toLowerCase().startsWith(needle)
          );
        });
        if (match !== undefined) {
          event.preventDefault();
          setActiveIndex(match);
        }
      }
    }
  };

  return (
    <div className={cn('relative', className)}>
      <button
        ref={triggerRef}
        type="button"
        role="menuitem"
        data-menu-trigger={id}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        tabIndex={0}
        onClick={() => setOpenMenuId(open ? null : id)}
        onKeyDown={onTriggerKeyDown}
        onPointerEnter={() => {
          // Once any menu is open, hovering a sibling switches to it — the
          // standard desktop behaviour that makes a menu bar feel native.
          if (hoverArmed) setOpenMenuId(id);
        }}
        className={cn(
          'rounded-md px-2.5 py-1 text-[13px] font-medium transition-colors duration-180 ease-apple-out',
          'text-content-light-primary dark:text-content-dark-primary',
          'hover:bg-black/[0.06] dark:hover:bg-white/[0.08]',
          'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-accent',
          open && 'bg-black/[0.08] dark:bg-white/[0.12]',
        )}
      >
        {label}
      </button>

      {open && (
        <div
          ref={listRef}
          id={menuId}
          role="menu"
          aria-label={label}
          tabIndex={-1}
          /*
           * Focus stays on the list and the highlight roves via
           * `aria-activedescendant`, rather than moving real DOM focus per item.
           * That is the APG-sanctioned alternative, and it is the right one here:
           * it keeps a single keydown handler authoritative and avoids the focus
           * thrash of calling `.focus()` on every arrow press.
           */
          aria-activedescendant={activeDescendantId}
          onKeyDown={onListKeyDown}
          className={cn(
            'absolute left-0 top-[calc(100%+4px)] z-50 min-w-[232px] animate-fade-in',
            'rounded-xl border border-hairline-light bg-white/90 p-1 shadow-panel backdrop-blur-xl',
            'dark:border-hairline-dark dark:bg-surface-dark-elevated/95 dark:shadow-panel-dark',
          )}
        >
          {items.map((item, index) => (
            <MenuRow
              key={item.id}
              rowId={`${menuId}-${item.id}`}
              item={item}
              active={index === activeIndex}
              onHover={() => isFocusable(item) && setActiveIndex(index)}
              onActivate={() => activate(item)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function MenuRow({
  rowId,
  item,
  active,
  onHover,
  onActivate,
}: {
  rowId: string;
  item: MenuItemSpec;
  active: boolean;
  onHover: () => void;
  onActivate: () => void;
}) {
  if (item.kind === 'separator') {
    return <div role="separator" className="my-1 h-px bg-hairline-light dark:bg-hairline-dark" />;
  }

  if (item.kind === 'submenu') {
    return (
      <div className="px-1 py-0.5">
        <div className="px-2 pb-1 pt-1.5 text-[11px] font-semibold uppercase tracking-wide text-content-light-secondary dark:text-content-dark-secondary">
          {item.label}
        </div>
        {item.items.map((child) => (
          <MenuRow
            key={child.id}
            rowId={`${rowId}-${child.id}`}
            item={child}
            active={false}
            onHover={() => undefined}
            onActivate={() => {
              if (child.kind !== 'separator' && child.kind !== 'submenu') child.onSelect?.();
            }}
          />
        ))}
      </div>
    );
  }

  const checked = item.kind === 'checkbox' ? item.checked : undefined;

  return (
    <button
      id={rowId}
      type="button"
      role={item.kind === 'checkbox' ? 'menuitemcheckbox' : 'menuitem'}
      aria-checked={checked}
      aria-disabled={item.disabled}
      disabled={item.disabled}
      title={item.hint}
      onPointerEnter={onHover}
      onClick={onActivate}
      className={cn(
        'flex w-full items-center gap-2 rounded-lg px-2 py-[6px] text-left text-[13px] transition-colors duration-180 ease-apple-out',
        'text-content-light-primary dark:text-content-dark-primary',
        active && !item.disabled && 'bg-accent text-white',
        item.disabled && 'cursor-not-allowed opacity-40',
      )}
    >
      <span className="flex w-4 shrink-0 justify-center" aria-hidden="true">
        {checked ? <CheckGlyph /> : null}
      </span>
      <span className="flex-1 truncate">{item.label}</span>
      {item.shortcut && (
        <span
          className={cn(
            'ml-4 shrink-0 font-mono text-[11px] tabular-nums',
            active && !item.disabled
              ? 'text-white/75'
              : 'text-content-light-secondary dark:text-content-dark-secondary',
          )}
        >
          {item.shortcut}
        </span>
      )}
    </button>
  );
}

function CheckGlyph() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
      <path d="M20 6L9 17l-5-5" />
    </svg>
  );
}
