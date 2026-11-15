import { ChevronLeft, GraduationCap, Home, Layers, Search, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { appById } from '../apps/registry';
import { useLaunchable } from '../stores/launchable';
import { AppIcon } from '../components/icons/AppIcon';
import { ErrorBoundary } from '../components/ErrorBoundary';
import { readableOn } from '../lib/color';
import { useServers } from '../stores/serverStore';
import { commands } from './commands';
import { openApp } from './openApp';
import { tryClose, useDesktop, type WindowState } from './windowStore';

/** The one window that is on screen in the compact layout: the highest non-minimized one. */
export function topWindowId(windows: Record<string, WindowState>): string | null {
  let top: WindowState | null = null;
  for (const w of Object.values(windows)) if (!w.minimized && (!top || w.z > top.z)) top = w;
  return top?.id ?? null;
}

/** Go back to the Home grid: every window is put away (they keep running). */
export function goHome(): void {
  const d = useDesktop.getState();
  for (const w of Object.values(d.windows)) if (!w.minimized) d.minimize(w.id);
}

/** Open an app, or bring back the one that is already running (like tapping it in a phone's launcher). */
function launch(appId: string): void {
  const running = Object.values(useDesktop.getState().windows).find((w) => w.appId === appId);
  if (running) useDesktop.getState().focus(running.id);
  else openApp(appById(appId)!);
}

/**
 * A window in the compact layout: it fills the workspace, has no dragging or resizing, and is shown only
 * while it is the top one. The others stay mounted (their terminals and polling keep running).
 */
export function CompactWindow({ win, visible }: { win: WindowState; visible: boolean }) {
  const closing = useDesktop((s) => !!s.closing[win.id]);
  const close = useDesktop((s) => s.close);
  const server = useServers((s) => s.servers.find((x) => x.id === win.serverId));
  const app = appById(win.appId);

  useEffect(() => {
    if (closing) close(win.id); // no close animation on a phone
  }, [closing, close, win.id]);

  if (!app) return null;
  const App = app.component;
  return (
    <div
      data-testid="window"
      data-app={win.appId}
      data-focused={visible}
      data-compact
      className="absolute inset-0 flex flex-col bg-background text-foreground"
      style={{ display: visible ? undefined : 'none', zIndex: win.z }}
    >
      <div className="glass-chrome grid h-11 shrink-0 grid-cols-[2.75rem_1fr_2.75rem] items-center border-b border-separator">
        <button
          aria-label="Home"
          className="grid h-11 w-11 place-items-center text-link"
          onClick={goHome}
        >
          <ChevronLeft size={22} />
        </button>
        <span className="flex min-w-0 items-center justify-center gap-2 text-body font-medium">
          <AppIcon app={app} size={18} />
          <span className="truncate">{win.title}</span>
          {server && (
            <span
              className="truncate rounded-full px-2 py-px text-caption font-medium"
              style={{ background: server.color, color: readableOn(server.color) }}
            >
              {server.name}
            </span>
          )}
        </span>
        <button
          aria-label="Close"
          className="grid h-11 w-11 place-items-center text-muted-foreground"
          onClick={() => tryClose(win.id)}
        >
          <X size={20} />
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-auto bg-background">
        <ErrorBoundary>
          <App windowId={win.id} />
        </ErrorBoundary>
      </div>
    </div>
  );
}

/** The launcher shown when no window is on screen: a grid of big app icons. */
export function MobileHome({ topGap }: { topGap: boolean }) {
  const launchable = useLaunchable();
  const windows = useDesktop((s) => s.windows);
  const running = new Set(Object.values(windows).map((w) => w.appId));
  return (
    <nav
      aria-label="Apps"
      data-testid="mobile-home"
      className={`absolute inset-0 grid auto-rows-min grid-cols-4 gap-x-2 gap-y-5 overflow-auto p-4 ${
        topGap ? 'pt-52' : 'pt-6'
      }`}
    >
      {launchable.map((app) => (
        <button
          key={app.id}
          data-tour={`app-${app.id}`}
          className="flex min-w-0 flex-col items-center gap-1.5 rounded-xl p-1 outline-offset-2"
          onClick={() => launch(app.id)}
        >
          <span className="relative">
            <AppIcon app={app} size={56} />
            {running.has(app.id) && (
              <span className="absolute -bottom-1 left-1/2 h-1.5 w-1.5 -translate-x-1/2 rounded-full bg-white shadow" />
            )}
          </span>
          <span className="max-w-full truncate rounded-full bg-black/70 px-2 py-0.5 text-center text-caption font-medium text-white">
            {app.title}
          </span>
        </button>
      ))}
    </nav>
  );
}

/** Bottom bar replacing the Dock: Home, the running windows, search, Learn. */
export function TabBar({ learnOpen, onLearn }: { learnOpen: boolean; onLearn: () => void }) {
  const windows = useDesktop((s) => s.windows);
  const [list, setList] = useState(false);
  const all = Object.values(windows).sort((a, b) => b.z - a.z);
  const top = topWindowId(windows);
  const btn =
    'flex h-full min-w-0 flex-1 flex-col items-center justify-center gap-0.5 text-caption font-medium';

  return (
    <>
      {list && (
        <div
          role="dialog"
          aria-label="Open windows"
          className="glass-popover absolute inset-x-2 bottom-[calc(var(--tabbar-h)+0.5rem)] z-[100001] max-h-[60%] overflow-auto rounded-window border border-separator p-2 shadow-elev-3"
        >
          {all.length === 0 && (
            <p className="p-3 text-center text-body text-muted-foreground">No open windows.</p>
          )}
          <ul>
            {all.map((w) => {
              const app = appById(w.appId);
              if (!app) return null;
              return (
                <li key={w.id} className="flex items-center">
                  <button
                    className="flex min-h-11 min-w-0 flex-1 items-center gap-3 rounded-lg px-2 text-left text-body hover:bg-accent"
                    aria-current={w.id === top}
                    onClick={() => {
                      useDesktop.getState().focus(w.id);
                      setList(false);
                    }}
                  >
                    <AppIcon app={app} size={28} />
                    <span className="truncate">{w.title}</span>
                  </button>
                  <button
                    aria-label={`Close ${w.title}`}
                    className="grid h-11 w-11 place-items-center text-muted-foreground"
                    onClick={() => tryClose(w.id)}
                  >
                    <X size={18} />
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      )}
      <nav
        aria-label="Navigation"
        data-testid="tab-bar"
        className="glass-chrome absolute inset-x-0 bottom-0 z-[100000] flex border-t border-separator text-foreground"
        style={{
          height: 'var(--tabbar-h)',
          paddingBottom: 'env(safe-area-inset-bottom)',
        }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <button
          aria-label="Home"
          className={btn}
          onClick={() => {
            setList(false);
            goHome();
          }}
        >
          <Home size={20} />
          Home
        </button>
        <button
          aria-label="Open windows"
          aria-expanded={list}
          className={btn}
          onClick={() => setList((v) => !v)}
        >
          <span className="relative">
            <Layers size={20} />
            {all.length > 0 && (
              <span
                data-testid="window-count"
                className="absolute -right-3 -top-1.5 grid min-w-4 place-items-center rounded-full bg-primary px-1 text-[10px] text-primary-foreground"
              >
                {all.length}
              </span>
            )}
          </span>
          Windows
        </button>
        <button aria-label="Search" className={btn} onClick={commands.spotlight}>
          <Search size={20} />
          Search
        </button>
        <button
          aria-label="Toggle Learn Mode"
          aria-pressed={learnOpen}
          className={`${btn} ${learnOpen ? 'text-link' : ''}`}
          onClick={onLearn}
        >
          <GraduationCap size={20} />
          Learn
        </button>
      </nav>
    </>
  );
}
