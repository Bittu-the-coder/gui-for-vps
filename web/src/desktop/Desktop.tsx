import { useEffect, useMemo, useRef, useState } from 'react';
import { appById } from '../apps/registry';
import { ChangePasswordDialog } from '../components/ChangePasswordDialog';
import { ConfirmHost } from '../components/ConfirmHost';
import { Menu, type MenuItem } from '../components/menu/Menu';
import { ToastHost } from '../components/toast/ToastHost';
import { LearnPanel } from '../learn/LearnPanel';
import { RunDialogHost } from '../runner/RunDialog';
import { useAppearance } from '../stores/appearanceStore';
import { useLearn } from '../stores/learnStore';
import { useServers } from '../stores/serverStore';
import { Tour } from '../tour/Tour';
import { tourSeen, useTour } from '../tour/tourStore';
import { ControlCenter } from './ControlCenter';
import { Dock } from './Dock';
import { MenuBar } from './MenuBar';
import { focusContext, shortcutFor } from './hotkeys';
import { commands } from './commands';
import { openApp } from './openApp';
import { useOverlays } from './overlayStore';
import { overviewLayout } from './overviewLayout';
import { Spotlight } from './Spotlight';
import { Wallpaper } from './Wallpaper';
import { WALLPAPERS } from './wallpapers';
import { Window } from './Window';
import { useDesktop } from './windowStore';

export function Desktop() {
  const windows = useDesktop((s) => s.windows);
  const close = useDesktop((s) => s.close);
  const theme = useDesktop((s) => s.theme);
  const learnOpen = useLearn((s) => s.open);
  const noServers = useServers((s) => s.servers.length === 0);
  const live = useServers((s) => s.live);
  const startTour = useTour((s) => s.start);
  const wallpaper = useAppearance((s) => s.wallpaper);
  const setWallpaper = useAppearance((s) => s.setWallpaper);
  const [ctx, setCtx] = useState<{ x: number; y: number } | null>(null);
  const overview = useOverlays((s) => s.overview);
  const passwordDialog = useOverlays((s) => s.passwordDialog);

  // Workspace size: Mission Control lays windows out inside it.
  const workspace = useRef<HTMLDivElement>(null);
  const [area, setArea] = useState({ w: 1200, h: 700 });
  useEffect(() => {
    const el = workspace.current;
    if (!el) return;
    const measure = () => setArea({ w: el.clientWidth, h: el.clientHeight });
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Global shortcuts (see hotkeys.ts for where they deliberately do not fire).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const o = useOverlays.getState();
      if (e.key === 'Escape' && o.overview) {
        o.setOverview(false);
        return;
      }
      const action = shortcutFor(e, focusContext(e.target));
      if (action === 'spotlight') commands.spotlight();
      else if (action === 'overview') commands.missionControl();
      else return;
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Mission Control: where each (visible) window goes, frontmost first.
  const slots = useMemo(() => {
    if (!overview) return null;
    const visible = Object.values(windows)
      .filter((w) => !w.minimized)
      .sort((a, b) => b.z - a.z)
      .map((w) => ({
        id: w.id,
        rect: w.maximized
          ? { x: 0, y: 0, w: area.w, h: area.h }
          : { x: w.x, y: w.y, w: w.w, h: w.h },
      }));
    return Object.fromEntries(overviewLayout(visible, area).map((s) => [s.id, s]));
  }, [overview, windows, area]);
  const overviewEmpty = overview && slots && Object.keys(slots).length === 0;

  // Arrow keys move between windows in Mission Control.
  useEffect(() => {
    if (!overview) return;
    const items = () => [...document.querySelectorAll<HTMLElement>('[data-overview-item]')];
    items()[0]?.focus();
    const onKey = (e: KeyboardEvent) => {
      const keys: Record<string, number> = {
        ArrowRight: 1,
        ArrowDown: 1,
        ArrowLeft: -1,
        ArrowUp: -1,
      };
      const step = keys[e.key];
      if (step === undefined || e.ctrlKey || e.metaKey) return;
      const list = items();
      const at = list.indexOf(document.activeElement as HTMLElement);
      list[(at + step + list.length) % list.length]?.focus();
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [overview]);

  // First visit: walk the user through the desktop once.
  useEffect(() => {
    if (!tourSeen()) startTour();
  }, [startTour]);

  // Windows saved from an older version may belong to apps that no longer exist.
  useEffect(() => {
    for (const w of Object.values(useDesktop.getState().windows)) {
      if (!appById(w.appId)) close(w.id);
    }
  }, [close]);

  // Right-click on the bare desktop: a small menu. Elsewhere the normal browser menu is left alone.
  const desktopMenu: MenuItem[] = [
    { label: 'New Terminal', onSelect: () => openApp(appById('terminal')!) },
    { label: 'Open Files', onSelect: () => openApp(appById('files')!) },
    { type: 'separator' },
    { type: 'label', label: 'Wallpaper' },
    ...WALLPAPERS.map<MenuItem>((w) => ({
      label: w.name,
      checked: wallpaper === w.id,
      onSelect: () => setWallpaper(w.id),
    })),
    { type: 'separator' },
    {
      label: theme === 'dark' ? 'Switch to Light' : 'Switch to Dark',
      onSelect: () => useDesktop.getState().toggleTheme(),
    },
  ];

  return (
    <div className="relative h-screen w-screen overflow-hidden text-foreground">
      <Wallpaper />
      <MenuBar />

      {/* The workspace sits under the menu bar and shrinks when the Learn panel is docked,
          so windows never hide under either. It is also the windows' drag boundary. */}
      <div
        ref={workspace}
        className="absolute bottom-0 left-0"
        style={{ top: 'var(--menubar-h)', right: learnOpen ? '20rem' : 0 }}
        onContextMenu={(e) => {
          if (e.target !== e.currentTarget) return;
          e.preventDefault();
          setCtx({ x: e.clientX, y: e.clientY });
        }}
      >
        {noServers && (
          <div className="glass-popover absolute left-1/2 top-1/3 w-80 -translate-x-1/2 rounded-window border border-separator p-5 text-center shadow-elev-3">
            <p className="text-title font-semibold">Add your first server</p>
            <p className="mt-1 text-body text-muted-foreground">
              Connect a VPS over SSH to open a terminal, browse files and install tools on it.
            </p>
            <button
              className="mt-3 rounded-control bg-primary px-4 py-2 text-body font-medium text-primary-foreground hover:bg-primary/90"
              onClick={() => openApp(appById('servers')!)}
            >
              Add a server
            </button>
          </div>
        )}

        {/* Mission Control: a dimmed, blurred layer under the (shrunken) windows. Clicking it leaves. */}
        {overview && (
          <div
            data-testid="overview-scrim"
            className="overview-in absolute inset-0 bg-[var(--scrim)] backdrop-blur-md"
            onClick={() => useOverlays.getState().setOverview(false)}
          />
        )}
        {overviewEmpty && (
          <p className="pointer-events-none absolute inset-x-0 top-1/3 text-center text-callout text-white [text-shadow:0_1px_3px_rgb(0_0_0/0.6)]">
            No open windows. Click an app in the Dock to start.
          </p>
        )}

        {Object.values(windows).map((w) => (
          <Window key={w.id} win={w} slot={slots?.[w.id]} />
        ))}

        <Dock />
      </div>

      {ctx && (
        <Menu
          label="Desktop"
          items={desktopMenu}
          x={ctx.x}
          y={ctx.y}
          onClose={() => setCtx(null)}
        />
      )}
      {learnOpen && <LearnPanel />}
      <Spotlight />
      <ControlCenter />
      <ToastHost />
      <ConfirmHost />
      {passwordDialog && (
        <ChangePasswordDialog onClose={() => useOverlays.getState().setPasswordDialog(false)} />
      )}
      <RunDialogHost />
      <Tour />
      {!live && (
        <div
          role="alert"
          className="absolute inset-x-0 z-[250000] bg-destructive px-3 py-1.5 text-center text-body text-destructive-foreground"
          style={{ top: 'var(--menubar-h)' }}
        >
          Lost the connection to GFV. Trying to reconnect… (is it still running?)
        </div>
      )}
    </div>
  );
}
