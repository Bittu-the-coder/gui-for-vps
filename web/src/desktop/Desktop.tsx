import { useEffect, useState } from 'react';
import { appById } from '../apps/registry';
import { Menu, type MenuItem } from '../components/menu/Menu';
import { LearnPanel } from '../learn/LearnPanel';
import { RunDialogHost } from '../runner/RunDialog';
import { useAppearance } from '../stores/appearanceStore';
import { useLearn } from '../stores/learnStore';
import { useServers } from '../stores/serverStore';
import { Tour } from '../tour/Tour';
import { tourSeen, useTour } from '../tour/tourStore';
import { Dock } from './Dock';
import { MenuBar } from './MenuBar';
import { openApp } from './openApp';
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

        {Object.values(windows).map((w) => (
          <Window key={w.id} win={w} />
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
      <RunDialogHost />
      <Tour />
      {!live && (
        <div
          role="alert"
          className="absolute inset-x-0 z-[250000] bg-red-600 px-3 py-1.5 text-center text-sm text-white"
          style={{ top: 'var(--menubar-h)' }}
        >
          Lost the connection to GFV. Trying to reconnect… (is it still running?)
        </div>
      )}
    </div>
  );
}
