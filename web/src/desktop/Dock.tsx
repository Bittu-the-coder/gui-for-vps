import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { LAUNCHABLE, appById, type AppDef } from '../apps/registry';
import { AppIcon } from '../components/icons/AppIcon';
import { Menu, type MenuItem } from '../components/menu/Menu';
import { DOCK, dockLayout } from './dockMath';
import { openApp } from './openApp';
import { useDesktop, type WindowState } from './windowStore';

/** True when the user asks for less motion (the Dock then does not magnify). */
function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(
    () =>
      typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches,
  );
  useEffect(() => {
    if (typeof matchMedia !== 'function') return;
    const q = matchMedia('(prefers-reduced-motion: reduce)');
    const on = () => setReduced(q.matches);
    q.addEventListener('change', on);
    return () => q.removeEventListener('change', on);
  }, []);
  return reduced;
}

interface Entry {
  key: string;
  app: AppDef;
  label: string;
  /** Set for minimized-window entries (after the separator). */
  win?: WindowState;
}

export function Dock() {
  const windows = useDesktop((s) => s.windows);
  const zoomed = useDesktop((s) => {
    const f = s.focusedId ? s.windows[s.focusedId] : undefined;
    return !!f && f.maximized && !f.minimized;
  });
  const [peek, setPeek] = useState(false);
  const tucked = zoomed && !peek;
  const reduced = useReducedMotion();
  const listRef = useRef<HTMLUListElement>(null);
  const [pointerX, setPointerX] = useState<number | null>(null);
  const [centers, setCenters] = useState<number[]>([]);
  const [menu, setMenu] = useState<{ x: number; y: number; entry: Entry } | null>(null);
  const [roving, setRoving] = useState(0);
  const [bouncing, setBouncing] = useState<Record<string, true>>({});
  const frame = useRef(0);

  const all = Object.values(windows);
  const entries: Entry[] = useMemo(() => {
    const apps = LAUNCHABLE.map<Entry>((app) => ({ key: app.id, app, label: app.title }));
    const minimized = all
      .filter((w) => w.minimized)
      .sort((a, b) => a.id.localeCompare(b.id))
      .flatMap<Entry>((w) => {
        const app = appById(w.appId);
        return app ? [{ key: w.id, app, label: w.title, win: w }] : [];
      });
    return [...apps, ...minimized];
  }, [windows]);
  const appCount = LAUNCHABLE.length;

  // Bounce an icon while its app is launching (a new window of that app appeared).
  const prevCounts = useRef<Record<string, number>>({});
  useEffect(() => {
    const counts: Record<string, number> = {};
    for (const w of all) counts[w.appId] = (counts[w.appId] ?? 0) + 1;
    const fresh = Object.keys(counts).filter((id) => counts[id]! > (prevCounts.current[id] ?? 0));
    prevCounts.current = counts;
    if (!fresh.length) return;
    setBouncing((b) => ({ ...b, ...Object.fromEntries(fresh.map((id) => [id, true as const])) }));
    const t = setTimeout(
      () =>
        setBouncing((b) => {
          const next = { ...b };
          for (const id of fresh) delete next[id];
          return next;
        }),
      1300,
    );
    return () => clearTimeout(t);
  }, [windows]);

  const measure = () => {
    const ul = listRef.current;
    if (!ul) return [];
    // offsetLeft/offsetWidth ignore transforms: the resting layout, so scaling cannot feed back.
    return Array.from(ul.querySelectorAll<HTMLElement>('[data-dock-slot]')).map(
      (li) => li.offsetLeft + li.offsetWidth / 2,
    );
  };

  const onMove = (e: React.PointerEvent) => {
    if (reduced || e.pointerType === 'touch') return;
    const x = e.clientX - (listRef.current?.getBoundingClientRect().left ?? 0);
    cancelAnimationFrame(frame.current);
    frame.current = requestAnimationFrame(() => {
      setCenters(measure());
      setPointerX(x);
    });
  };
  const onLeave = () => {
    cancelAnimationFrame(frame.current);
    setPointerX(null);
  };

  const layout = useMemo(
    () => dockLayout(centers.length === entries.length ? centers : [], pointerX),
    [centers, entries.length, pointerX],
  );
  const hovered =
    pointerX === null || !layout.scales.length
      ? -1
      : layout.scales.indexOf(Math.max(...layout.scales));

  // Edges of the magnified row (resting layout when idle), so the glass bar can wrap them.
  const bar = useMemo(() => {
    if (!layout.scales.length || centers.length !== entries.length) return null;
    const lefts = centers.map(
      (c, i) => c + layout.offsets[i]! - (DOCK.size * layout.scales[i]!) / 2,
    );
    const rights = centers.map(
      (c, i) => c + layout.offsets[i]! + (DOCK.size * layout.scales[i]!) / 2,
    );
    const left = Math.min(...lefts);
    return { left, width: Math.max(...rights) - left + 16 };
  }, [layout, centers, entries.length]);

  const appWindows = (appId: string) =>
    all.filter((w) => w.appId === appId).sort((a, b) => b.z - a.z);

  const activate = (e: Entry) => {
    if (e.win) return useDesktop.getState().focus(e.win.id);
    const ws = appWindows(e.app.id);
    if (ws.length === 0) return openApp(e.app);
    useDesktop.getState().focus(ws[0]!.id); // focus restores it if minimized
  };

  const menuItems = (e: Entry): MenuItem[] => {
    const d = useDesktop.getState();
    if (e.win) {
      const id = e.win.id;
      return [
        { label: 'Restore', onSelect: () => d.focus(id) },
        { label: 'Close', onSelect: () => d.requestClose(id) },
      ];
    }
    const ws = appWindows(e.app.id);
    return [
      ...(ws.length
        ? ([
            { type: 'label', label: 'Windows' },
            ...ws.map<MenuItem>((w) => ({
              label: w.minimized ? `${w.title} (minimized)` : w.title,
              onSelect: () => d.focus(w.id),
            })),
            { type: 'separator' },
          ] as MenuItem[])
        : []),
      {
        label: 'New Window',
        disabled: !!e.app.singleton && ws.length > 0,
        onSelect: () => openApp(e.app),
      },
      ...(ws.length
        ? ([
            { type: 'separator' },
            {
              label: ws.length > 1 ? 'Close All Windows' : 'Close Window',
              onSelect: () => ws.forEach((w) => d.requestClose(w.id)),
            },
          ] as MenuItem[])
        : []),
    ];
  };

  const onKeyDown = (ev: React.KeyboardEvent) => {
    const n = entries.length;
    const go = (i: number) => {
      const next = (i + n) % n;
      setRoving(next);
      listRef.current?.querySelectorAll<HTMLElement>('[data-dock-item]')[next]?.focus();
    };
    if (ev.key === 'ArrowRight') go(roving + 1);
    else if (ev.key === 'ArrowLeft') go(roving - 1);
    else if (ev.key === 'Home') go(0);
    else if (ev.key === 'End') go(n - 1);
    else return;
    ev.preventDefault();
  };

  return (
    <div
      className="pointer-events-none absolute inset-x-0 bottom-2 z-[100000] flex justify-center"
      onMouseDown={(e) => e.stopPropagation()}
    >
      {/* While a zoomed window fills the screen the Dock tucks away; touching the bottom edge brings it back.
          (This strip stays put: only the bar below is transformed, because fixed children follow a transformed parent.) */}
      {zoomed && (
        <div
          data-testid="dock-reveal"
          aria-hidden
          className="pointer-events-auto fixed inset-x-0 bottom-0 z-[100001] h-2"
          onPointerEnter={() => setPeek(true)}
        />
      )}
      <div
        className="pointer-events-auto relative px-2 pb-1 pt-2"
        style={{
          transform: tucked ? 'translateY(calc(100% + 16px))' : 'none',
          transition: reduced ? undefined : 'transform var(--dur) var(--ease-out)',
        }}
        onPointerMove={onMove}
        onPointerLeave={() => {
          onLeave();
          setPeek(false);
        }}
      >
        {/* The glass bar is a separate layer so it can grow to hold the magnified icons. */}
        <div
          aria-hidden
          className="glass-chrome absolute inset-y-0 rounded-[22px] border border-separator shadow-elev-3"
          style={
            bar
              ? {
                  left: bar.left,
                  width: bar.width,
                  transition: reduced ? undefined : 'left 90ms ease-out, width 90ms ease-out',
                }
              : { left: 0, right: 0 }
          }
        />
        <ul
          ref={listRef}
          role="toolbar"
          aria-label="Dock"
          aria-orientation="horizontal"
          className="relative flex items-end gap-2"
          onKeyDown={onKeyDown}
        >
          {entries.map((e, i) => {
            const isMin = !!e.win;
            const running = !isMin && appWindows(e.app.id).length > 0;
            const s = layout.scales[i] ?? 1;
            const o = layout.offsets[i] ?? 0;
            return (
              <Fragment key={e.key}>
                {i === appCount && (
                  <li
                    role="separator"
                    aria-orientation="vertical"
                    className="mx-1 w-px self-stretch bg-separator"
                  />
                )}
                <li
                  data-dock-slot
                  className="relative flex flex-col items-center"
                  style={{ width: DOCK.size, height: DOCK.size + 10 }}
                >
                  <button
                    data-dock-item
                    data-tour={isMin ? undefined : `app-${e.app.id}`}
                    data-win-anchor={e.win?.id}
                    aria-label={e.label}
                    tabIndex={i === roving ? 0 : -1}
                    onFocus={() => setRoving(i)}
                    onClick={() => activate(e)}
                    onContextMenu={(ev) => {
                      ev.preventDefault();
                      setMenu({ x: ev.clientX, y: ev.clientY, entry: e });
                    }}
                    className="rounded-[12px] outline-offset-2"
                    style={{
                      transform: `translateX(${o}px) scale(${s})`,
                      transformOrigin: 'bottom center',
                      transition: reduced ? undefined : 'transform 90ms ease-out',
                    }}
                  >
                    <span className={bouncing[e.app.id] && !isMin ? 'dock-bounce block' : 'block'}>
                      <AppIcon app={e.app} size={DOCK.size} />
                    </span>
                  </button>
                  <span
                    aria-hidden
                    className={`absolute bottom-0 h-1 w-1 rounded-full bg-foreground/70 ${running ? '' : 'invisible'}`}
                  />
                  {i === hovered && s > 1.2 && (
                    <span
                      aria-hidden
                      className="glass-popover pointer-events-none absolute left-1/2 z-10 whitespace-nowrap rounded-md border border-separator px-2 py-0.5 text-footnote shadow-elev-2"
                      style={{
                        bottom: `calc(100% + ${(s - 1) * DOCK.size + 6}px)`,
                        transform: `translateX(calc(-50% + ${o}px))`,
                      }}
                    >
                      {e.label}
                    </span>
                  )}
                </li>
              </Fragment>
            );
          })}
        </ul>
      </div>
      {menu && (
        <Menu
          label={`${menu.entry.label} options`}
          items={menuItems(menu.entry)}
          x={menu.x}
          y={menu.y}
          anchor="above"
          minWidth={180}
          onClose={() => setMenu(null)}
        />
      )}
    </div>
  );
}
