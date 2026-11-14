import {
  Circle,
  GraduationCap,
  Maximize,
  Minimize,
  Moon,
  Search,
  SlidersHorizontal,
  Sun,
} from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { LAUNCHABLE, appById } from '../apps/registry';
import { GfvMark } from '../components/icons/GfvMark';
import { Menu, type MenuItem } from '../components/menu/Menu';
import { useAppearance } from '../stores/appearanceStore';
import { useLearn } from '../stores/learnStore';
import { useRecording } from '../stores/recordingStore';
import { useServers } from '../stores/serverStore';
import { toast } from '../stores/toastStore';
import { useTour } from '../tour/tourStore';
import { appMenusFor } from './appMenus';
import { commands } from './commands';
import { fullscreenSupported, toggleFullscreen, useFullscreen } from './fullscreen';
import { buildMenus, type MenuKey } from './menuModel';
import { openApp } from './openApp';
import { useOverlays } from './overlayStore';
import { useDesktop } from './windowStore';

const STATUS_DOT: Record<string, string> = {
  connected: 'bg-success',
  connecting: 'bg-warning',
  error: 'bg-danger',
  disconnected: 'bg-faint-foreground',
};

const BAR_BTN =
  'flex h-[22px] items-center gap-1.5 rounded px-2 text-body hover:bg-foreground/10 aria-expanded:bg-foreground/15 focus-visible:outline-offset-0';

/**
 * A menu-bar button that opens a Menu under itself. `data-menu-trigger` lets the button toggle its own menu.
 * `items` may be a function: it is called only while the menu is open, so the items (and which are
 * enabled) are always built from the state at that moment.
 */
function BarMenu({
  id,
  open,
  setOpen,
  items,
  children,
  className = '',
  ariaLabel,
  onNavigate,
  align = 'left',
  ...rest
}: {
  id: string;
  open: string | null;
  setOpen: (id: string | null) => void;
  items: MenuItem[] | (() => MenuItem[]);
  children: ReactNode;
  className?: string;
  ariaLabel?: string;
  onNavigate?: (dir: 1 | -1) => void;
  align?: 'left' | 'right';
  'data-tour'?: string;
}) {
  const ref = useRef<HTMLButtonElement>(null);
  const isOpen = open === id;
  const r = isOpen ? ref.current?.getBoundingClientRect() : undefined;
  return (
    <>
      <button
        ref={ref}
        data-menu-trigger
        aria-haspopup="menu"
        aria-expanded={isOpen}
        aria-label={ariaLabel}
        className={`${BAR_BTN} ${className}`}
        onClick={() => setOpen(isOpen ? null : id)}
        // Moving across the bar while a menu is open switches menus (like macOS).
        onPointerEnter={() => open && open !== id && id.startsWith('m:') && setOpen(id)}
        {...rest}
      >
        {children}
      </button>
      {isOpen && r && (
        <Menu
          label={ariaLabel ?? id}
          items={typeof items === 'function' ? items() : items}
          x={align === 'right' ? r.right - 220 : r.left}
          y={r.bottom + 2}
          onClose={() => {
            setOpen(null);
            ref.current?.focus();
          }}
          onNavigate={onNavigate}
        />
      )}
    </>
  );
}

export function MenuBar() {
  const windows = useDesktop((s) => s.windows);
  const focusedId = useDesktop((s) => s.focusedId);
  const theme = useDesktop((s) => s.theme);
  const appearance = useAppearance();
  const { open: learnOpen, toggle: toggleLearn } = useLearn();
  const startTour = useTour((s) => s.start);
  const { servers, statuses, activeId, setActive } = useServers();
  const recording = useRecording((s) => s.active);
  const refreshRecording = useRecording((s) => s.refresh);
  const controlCenterOpen = useOverlays((s) => s.controlCenter);
  const fullscreen = useFullscreen();

  const [open, setOpen] = useState<string | null>(null);
  const [now, setNow] = useState(() => new Date());
  useEffect(() => void refreshRecording(), [refreshRecording]);
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 15_000);
    return () => clearInterval(t);
  }, []);

  const activeWindow = focusedId ? windows[focusedId] : undefined;
  const activeApp = activeWindow ? appById(activeWindow.appId) : undefined;
  const server = servers.find((s) => s.id === activeId);

  /** Built when a menu opens (see BarMenu): the focused app's items and the current selection are fresh. */
  const menus = () => {
    const d = useDesktop.getState();
    return buildMenus({
      activeApp,
      activeWindow,
      windows: Object.values(windows),
      app: appMenusFor(focusedId ?? undefined),
      selectedText: window.getSelection()?.toString() ?? '',
      theme,
      wallpaper: appearance.wallpaper,
      reduceTransparency: appearance.reduceTransparency,
      learnOpen,
      fullscreen,
      launchable: LAUNCHABLE,
      act: {
        openApp,
        copyText: (text) => {
          void navigator.clipboard?.writeText(text).then(() => toast({ title: 'Copied' }));
        },
        missionControl: commands.missionControl,
        toggleFullscreen: () => void toggleFullscreen(),
        closeWindow: d.requestClose,
        minimize: d.minimize,
        zoom: d.toggleMaximize,
        focus: d.focus,
        setTheme: d.setTheme,
        setWallpaper: appearance.setWallpaper,
        setReduceTransparency: appearance.setReduceTransparency,
        toggleLearn,
        tour: startTour,
        changePassword: commands.changePassword,
        lock: commands.lock,
      },
    });
  };

  const ORDER: MenuKey[] = ['file', 'edit', 'view', 'window', 'help'];
  const keys = ['gfv', ...ORDER] as MenuKey[];
  const step = (from: MenuKey) => (dir: 1 | -1) =>
    setOpen(`m:${keys[(keys.indexOf(from) + dir + keys.length) % keys.length]}`);
  const TITLES: Record<MenuKey, string> = {
    gfv: 'GFV',
    file: 'File',
    edit: 'Edit',
    view: 'View',
    window: 'Window',
    help: 'Help',
  };

  const serverItems = (): MenuItem[] => [
    ...servers.map<MenuItem>((s) => ({
      label: s.name,
      checked: s.id === activeId,
      icon: (
        <span className={`h-2 w-2 rounded-full ${STATUS_DOT[statuses[s.id] ?? 'disconnected']}`} />
      ),
      onSelect: () => setActive(s.id),
    })),
    ...(servers.length ? ([{ type: 'separator' }] as MenuItem[]) : []),
    { label: 'Manage Servers…', onSelect: () => openApp(appById('servers')!) },
  ];

  return (
    <header
      className="glass-chrome absolute inset-x-0 top-0 z-[100000] flex items-center justify-between border-b border-separator px-2 text-foreground"
      style={{ height: 'var(--menubar-h)' }}
      onMouseDown={(e) => e.stopPropagation()}
    >
      <nav aria-label="Menu bar" className="flex items-center gap-0.5">
        <BarMenu
          id="m:gfv"
          open={open}
          setOpen={setOpen}
          items={() => menus().gfv}
          ariaLabel="GFV menu"
          onNavigate={step('gfv')}
        >
          <GfvMark />
        </BarMenu>
        <span className="px-2 text-body font-semibold">{activeApp?.title ?? 'GFV'}</span>
        {ORDER.map((k) => (
          <BarMenu
            key={k}
            id={`m:${k}`}
            open={open}
            setOpen={setOpen}
            items={() => menus()[k]}
            ariaLabel={`${TITLES[k]} menu`}
            onNavigate={step(k)}
          >
            {TITLES[k]}
          </BarMenu>
        ))}
      </nav>

      <div className="flex items-center gap-0.5">
        <button
          aria-label="Search"
          title="Spotlight: search apps, windows, servers and commands (Ctrl+K)"
          className={BAR_BTN}
          onClick={commands.spotlight}
        >
          <Search size={14} />
        </button>

        <span data-tour="server-switcher">
          <BarMenu
            id="server"
            open={open}
            setOpen={setOpen}
            items={serverItems}
            ariaLabel="Active server"
            align="right"
          >
            <span
              className={`h-2 w-2 rounded-full ${STATUS_DOT[server ? (statuses[server.id] ?? 'disconnected') : 'disconnected']}`}
            />
            <span className="max-w-32 truncate">{server ? server.name : 'No server'}</span>
          </BarMenu>
        </span>

        {recording ? (
          <button
            data-tour="record"
            aria-label="Stop recording"
            title={`Recording "${recording.name}" on ${servers.find((x) => x.id === recording.serverId)?.name ?? 'a server'}`}
            className={`${BAR_BTN} text-danger`}
            onClick={() => void commands.toggleRecording()}
          >
            <Circle size={10} fill="currentColor" className="animate-pulse" />
            Stop ({recording.stepCount})
          </button>
        ) : (
          <button
            data-tour="record"
            aria-label="Start recording"
            title="Record the actions you run so you can export them as a bash script"
            disabled={!activeId}
            className={`${BAR_BTN} disabled:opacity-40`}
            onClick={() => void commands.toggleRecording()}
          >
            <Circle size={10} className="text-danger" fill="currentColor" />
            Record
          </button>
        )}

        <button
          data-tour="learn"
          aria-label="Toggle Learn Mode"
          aria-pressed={learnOpen}
          title="Learn Mode: see the commands behind every action"
          className={`${BAR_BTN} ${learnOpen ? 'bg-foreground/15' : ''}`}
          onClick={toggleLearn}
        >
          <GraduationCap size={15} />
          Learn
        </button>

        {fullscreenSupported() && (
          <button
            aria-label={fullscreen ? 'Exit full screen' : 'Enter full screen'}
            aria-pressed={fullscreen}
            title={fullscreen ? 'Exit full screen (Esc)' : 'Make GFV fill the whole screen'}
            className={BAR_BTN}
            onClick={() => void toggleFullscreen()}
          >
            {fullscreen ? <Minimize size={14} /> : <Maximize size={14} />}
          </button>
        )}
        <button
          data-menu-trigger
          aria-label="Control Center"
          aria-haspopup="dialog"
          aria-expanded={controlCenterOpen}
          title="Control Center: server, theme, wallpaper, Learn, Record, lock"
          className={BAR_BTN}
          onClick={commands.controlCenter}
        >
          {theme === 'dark' ? <Moon size={13} /> : <Sun size={14} />}
          <SlidersHorizontal size={14} />
        </button>

        <span className="px-2 text-body tabular-nums">
          {now.toLocaleString([], {
            weekday: 'short',
            month: 'short',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
          })}
        </span>
      </div>
    </header>
  );
}
