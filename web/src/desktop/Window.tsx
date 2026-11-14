import { Maximize2, Minus, X } from 'lucide-react';
import { useEffect, useLayoutEffect, useRef, useState, type MouseEvent } from 'react';
import { Rnd } from 'react-rnd';
import { appById } from '../apps/registry';
import { readableOn } from '../lib/color';
import { AppIcon } from '../components/icons/AppIcon';
import { ErrorBoundary } from '../components/ErrorBoundary';
import { useServers } from '../stores/serverStore';
import {
  animateClose,
  animateMinimize,
  animateOpen,
  animateRestore,
  clearAnimations,
  minimizeTarget,
} from './windowAnim';
import { DOCK_SAFE } from './layout';
import { useOverlays } from './overlayStore';
import type { Slot } from './overviewLayout';
import { consumeFresh, tryClose, useDesktop, type WindowState } from './windowStore';

// Tailwind only generates classes it can read literally, so every variant is spelled out in full.
const BTN =
  'grid h-4 w-4 place-items-center rounded-full focus-visible:outline-offset-1 [&>span]:grid [&>span]:h-3 [&>span]:w-3 [&>span]:place-items-center [&>span]:rounded-full [&>span]:text-black/55 [&>span]:ring-[0.5px] [&>span]:ring-inset [&>span]:ring-black/20';
const GLYPH = 'opacity-0 transition-opacity group-hover/tl:opacity-100';
const CLOSE = {
  on: 'bg-tl-close',
  off: 'bg-tl-inactive group-hover/tl:bg-tl-close',
};
const MINIMIZE = {
  on: 'bg-tl-minimize',
  off: 'bg-tl-inactive group-hover/tl:bg-tl-minimize',
};
const ZOOM = {
  on: 'bg-tl-zoom',
  off: 'bg-tl-inactive group-hover/tl:bg-tl-zoom',
};

/** The three coloured buttons. Their symbols show when the pointer is over the group (like macOS). */
function TrafficLights({ win, active }: { win: WindowState; active: boolean }) {
  const minimize = useDesktop((s) => s.minimize);
  const toggleMaximize = useDesktop((s) => s.toggleMaximize);
  // Inactive windows show grey dots until the pointer is over the group.
  const c = (v: { on: string; off: string }) => (active ? v.on : v.off);
  const stop = (e: MouseEvent) => e.stopPropagation(); // not a title-bar double-click
  return (
    <div className="group/tl flex items-center gap-1" onDoubleClick={stop}>
      <button aria-label="Close" title="Close" className={BTN} onClick={() => tryClose(win.id)}>
        <span className={c(CLOSE)}>
          <X size={8} strokeWidth={3.5} className={GLYPH} />
        </span>
      </button>
      <button
        aria-label="Minimize"
        title="Minimize"
        className={BTN}
        onClick={() => minimize(win.id)}
      >
        <span className={c(MINIMIZE)}>
          <Minus size={8} strokeWidth={3.5} className={GLYPH} />
        </span>
      </button>
      <button
        aria-label="Maximize"
        title={win.maximized ? 'Restore size' : 'Maximize'}
        className={BTN}
        onClick={() => toggleMaximize(win.id)}
      >
        <span className={c(ZOOM)}>
          <Maximize2 size={7} strokeWidth={3.5} className={GLYPH} />
        </span>
      </button>
    </div>
  );
}

/** `slot` is where Mission Control wants this window (set only while the overview is open). */
export function Window({ win, slot }: { win: WindowState; slot?: Slot }) {
  const { focus, toggleMaximize, move, resize, focusedId } = useDesktop();
  const closing = useDesktop((s) => !!s.closing[win.id]);
  const setOverview = useOverlays((s) => s.setOverview);
  const overview = !!slot;
  const server = useServers((s) => s.servers.find((x) => x.id === win.serverId));
  const app = appById(win.appId);
  const frameRef = useRef<HTMLDivElement>(null);
  const restoring = useRef(false);
  // `hidden` lags behind `win.minimized`: the window stays visible while its minimize animation plays.
  const [hidden, setHidden] = useState(win.minimized);
  // Maximize/restore animates the rectangle. The class must be on in the SAME render that changes the
  // rectangle, so it is derived while rendering (not in an effect).
  const [lastMax, setLastMax] = useState(win.maximized);
  const [rectAnim, setRectAnim] = useState(false);
  if (lastMax !== win.maximized) {
    setLastMax(win.maximized);
    setRectAnim(true);
  }
  useEffect(() => {
    if (!rectAnim) return;
    const t = setTimeout(() => setRectAnim(false), 450);
    return () => clearTimeout(t);
  }, [rectAnim]);

  // New windows (not ones restored from a reload) animate in.
  useEffect(() => {
    if (frameRef.current && consumeFresh(win.id)) void animateOpen(frameRef.current);
  }, [win.id]);

  // Minimize: animate toward the Dock/taskbar, then hide. Restore: show, then animate back out.
  useEffect(() => {
    const el = frameRef.current;
    if (!el) return;
    if (win.minimized && !hidden) {
      void animateMinimize(el, minimizeTarget(win.id, win.appId)).then(() => {
        // The user may have restored it while the animation was still running.
        if (useDesktop.getState().windows[win.id]?.minimized) setHidden(true);
        else clearAnimations(el);
      });
    } else if (!win.minimized && hidden) {
      restoring.current = true;
      setHidden(false);
    }
  }, [win.minimized, hidden, win.id, win.appId]);

  useLayoutEffect(() => {
    const el = frameRef.current;
    if (hidden || !el || !restoring.current) return;
    restoring.current = false;
    clearAnimations(el);
    void animateRestore(el, minimizeTarget(win.id, win.appId));
  }, [hidden, win.id, win.appId]);

  // Close: animate out, then really remove (a timer is the safety net if the animation never ends).
  useEffect(() => {
    if (!closing) return;
    const done = () => {
      if (useDesktop.getState().windows[win.id]) useDesktop.getState().close(win.id);
    };
    const el = frameRef.current;
    if (!el || hidden) {
      done();
      return;
    }
    void animateClose(el).then(done);
    const t = setTimeout(done, 800);
    return () => clearTimeout(t);
  }, [closing, hidden, win.id]);

  if (!app) return null;
  const focused = focusedId === win.id;
  const App = app.component;

  // Maximized = a CSS-level override. The stored x/y/w/h stay untouched,
  // so restoring is trivial and react-rnd's drag is just disabled.
  const rect = win.maximized
    ? { x: 0, y: 0, width: '100%', height: `calc(100% - ${DOCK_SAFE}px)` }
    : { x: win.x, y: win.y, width: win.w, height: win.h };

  // A window tied to a server gets a ring in that server's colour (dimmed when inactive), so you can
  // always tell which machine it talks to. The pill in the title bar says the name.
  const elevation = focused ? 'var(--elev-window)' : 'var(--elev-window-inactive)';
  const ring = server
    ? `, 0 0 0 1.5px ${focused ? server.color : `color-mix(in srgb, ${server.color} 55%, transparent)`}`
    : '';

  return (
    <Rnd
      className={rectAnim ? 'win-rect-anim' : undefined}
      position={{ x: rect.x, y: rect.y }}
      size={{ width: rect.width, height: rect.height }}
      minWidth={200}
      minHeight={120}
      bounds="parent"
      dragHandleClassName="win-titlebar"
      disableDragging={win.maximized || overview}
      enableResizing={!win.maximized && !overview}
      onMouseDown={() => focus(win.id)}
      onDragStop={(_e, d) => move(win.id, d.x, d.y)}
      onResizeStop={(_e, _dir, ref, _delta, pos) =>
        resize(win.id, ref.offsetWidth, ref.offsetHeight, pos.x, pos.y)
      }
      style={{
        zIndex: win.z,
        display: hidden ? 'none' : undefined,
        // In Mission Control the wrapper still covers the window's original (unscaled) area: let pointer events
        // fall through it, so only the shrunken card's own button receives clicks.
        pointerEvents: closing || overview ? 'none' : undefined,
      }}
    >
      <div
        ref={frameRef}
        data-testid="window"
        data-app={win.appId}
        data-focused={focused}
        className={`flex h-full flex-col overflow-hidden text-foreground ${
          win.maximized ? '' : 'rounded-window'
        }`}
        data-overview={overview || undefined}
        style={{
          boxShadow: elevation + ring,
          ...(slot
            ? {
                transform: `translate(${slot.dx}px, ${slot.dy}px) scale(${slot.scale})`,
                transformOrigin: 'center',
                transition: 'transform var(--dur-slow) var(--ease-out)',
              }
            : { transition: 'transform var(--dur-slow) var(--ease-out)' }),
        }}
      >
        {overview && (
          <button
            data-overview-item
            aria-label={`Show ${win.title}`}
            className="pointer-events-auto absolute inset-0 z-20 cursor-pointer rounded-window outline-offset-8"
            onClick={() => {
              focus(win.id);
              setOverview(false);
            }}
          />
        )}
        <div
          className="win-titlebar glass-chrome relative grid h-9 shrink-0 select-none grid-cols-[1fr_auto_1fr] items-center border-b border-separator px-3"
          onDoubleClick={() => toggleMaximize(win.id)}
        >
          <TrafficLights win={win} active={focused} />
          <span
            className={`flex min-w-0 max-w-[60vw] items-center justify-center gap-2 text-body font-medium ${
              focused ? 'text-foreground' : 'text-faint-foreground'
            }`}
          >
            <AppIcon app={app} size={16} className={focused ? '' : 'opacity-60'} />
            <span className="truncate">{win.title}</span>
            {server && (
              <span
                className="truncate rounded-full px-2 py-px text-caption font-medium"
                style={{ background: server.color, color: readableOn(server.color) }}
                title={`${server.username}@${server.host}`}
              >
                {server.name}
              </span>
            )}
          </span>
          <span />
        </div>
        <div className="min-h-0 flex-1 overflow-auto bg-background">
          <ErrorBoundary>
            <App windowId={win.id} />
          </ErrorBoundary>
        </div>
      </div>
      {slot && (
        <span
          className="pointer-events-none absolute z-10 flex max-w-[260px] -translate-x-1/2 items-center gap-1.5 truncate text-body font-medium text-white [text-shadow:0_1px_3px_rgb(0_0_0/0.6)]"
          style={{
            left: slot.target.x + slot.target.w / 2 - rect.x,
            top: slot.target.y + slot.target.h + 8 - rect.y,
          }}
        >
          <AppIcon app={app} size={16} />
          <span className="truncate">{win.title}</span>
        </span>
      )}
    </Rnd>
  );
}
