import { Check } from 'lucide-react';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { clampToViewport, isActionable, nextActionable, type MenuItem } from './menuItems';

export type { MenuItem } from './menuItems';

/**
 * A floating menu (menu bar dropdowns, context menus). Keyboard: Up/Down/Home/End move, Enter or Space
 * chooses, Escape or Tab closes, Left/Right call `onNavigate` (the menu bar uses it to switch menus).
 * Clicking outside closes it, except on a `[data-menu-trigger]` (which toggles the menu itself).
 */
export function Menu({
  items,
  x,
  y,
  anchor = 'below',
  minWidth = 200,
  label,
  onClose,
  onNavigate,
}: {
  items: MenuItem[];
  x: number;
  y: number;
  /** "above": (x, y) is the menu's bottom-left corner instead of its top-left. */
  anchor?: 'below' | 'above';
  minWidth?: number;
  label: string;
  onClose: () => void;
  onNavigate?: (dir: 1 | -1) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  const hasChecks = items.some((i) => 'checked' in i && i.checked !== undefined);

  // Measure, then place inside the viewport (hidden until placed, so it never flashes in the wrong spot).
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const { width, height } = el.getBoundingClientRect();
    const top = anchor === 'above' ? y - height : y;
    setPos(clampToViewport(x, top, width, height, window.innerWidth, window.innerHeight));
  }, [x, y, anchor, items.length]);

  const focusAt = (itemIndex: number) =>
    ref.current?.querySelector<HTMLElement>(`[data-i="${itemIndex}"]`)?.focus();

  // Focus the first item, but only once the menu is placed: a `visibility: hidden` element cannot take focus.
  const focused = useRef(false);
  useEffect(() => {
    if (!pos || focused.current) return;
    focused.current = true;
    focusAt(nextActionable(items, -1, 1));
  }, [pos, items]);

  useEffect(() => {
    const down = (e: PointerEvent) => {
      const t = e.target as Element | null;
      if (ref.current?.contains(t) || t?.closest('[data-menu-trigger]')) return;
      onClose();
    };
    window.addEventListener('pointerdown', down, true);
    window.addEventListener('blur', onClose);
    return () => {
      window.removeEventListener('pointerdown', down, true);
      window.removeEventListener('blur', onClose);
    };
  }, [onClose]);

  const onKeyDown = (e: React.KeyboardEvent) => {
    const idx = Number((document.activeElement as HTMLElement | null)?.dataset.i ?? -1);
    switch (e.key) {
      case 'ArrowDown':
        focusAt(nextActionable(items, idx, 1));
        break;
      case 'ArrowUp':
        focusAt(nextActionable(items, idx === -1 ? 0 : idx, -1));
        break;
      case 'Home':
        focusAt(nextActionable(items, -1, 1));
        break;
      case 'End':
        focusAt(nextActionable(items, 0, -1));
        break;
      case 'ArrowLeft':
        if (!onNavigate) return;
        onNavigate(-1);
        break;
      case 'ArrowRight':
        if (!onNavigate) return;
        onNavigate(1);
        break;
      case 'Escape':
      case 'Tab':
        onClose();
        break;
      default:
        return;
    }
    e.preventDefault();
    e.stopPropagation();
  };

  return createPortal(
    <div
      ref={ref}
      role="menu"
      aria-label={label}
      onKeyDown={onKeyDown}
      onContextMenu={(e) => e.preventDefault()}
      className="glass-popover fixed z-[200000] rounded-lg border border-separator p-1 text-body text-foreground shadow-elev-3"
      style={{
        left: pos?.x ?? x,
        top: pos?.y ?? y,
        minWidth,
        visibility: pos ? 'visible' : 'hidden',
      }}
    >
      {items.map((item, i) => {
        if (item.type === 'separator')
          return <div key={i} role="separator" className="mx-2 my-1 h-px bg-separator" />;
        if (item.type === 'label')
          return (
            <div
              key={i}
              className="px-2.5 pb-0.5 pt-1.5 text-caption font-medium text-faint-foreground"
            >
              {item.label}
            </div>
          );
        const checkable = item.checked !== undefined;
        return (
          <button
            key={i}
            data-i={i}
            role={checkable ? 'menuitemcheckbox' : 'menuitem'}
            aria-checked={checkable ? item.checked : undefined}
            aria-disabled={item.disabled || undefined}
            disabled={item.disabled}
            tabIndex={-1}
            onClick={() => {
              if (!isActionable(item)) return;
              onClose();
              item.onSelect();
            }}
            className={`flex h-7 w-full items-center gap-2 rounded-md px-2 text-left outline-none focus:bg-primary focus:text-primary-foreground enabled:hover:bg-primary enabled:hover:text-primary-foreground disabled:opacity-40 ${
              item.danger ? 'text-danger' : ''
            }`}
          >
            {hasChecks && (
              <span className="grid w-4 place-items-center">
                {item.checked && <Check size={13} strokeWidth={3} />}
              </span>
            )}
            {item.icon && <span className="grid w-4 place-items-center">{item.icon}</span>}
            <span className="flex-1 truncate">{item.label}</span>
            {item.shortcut && (
              <span className="ml-4 text-footnote opacity-60">{item.shortcut}</span>
            )}
          </button>
        );
      })}
    </div>,
    document.body,
  );
}
