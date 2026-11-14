import { Circle, GraduationCap, Lock, Moon, Sun } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { LAUNCHABLE, appById } from '../apps/registry';
import { ChangePasswordDialog } from '../components/ChangePasswordDialog';
import { Menu, type MenuItem } from '../components/menu/Menu';
import { useAppearance } from '../stores/appearanceStore';
import { useLearn } from '../stores/learnStore';
import { useRecording } from '../stores/recordingStore';
import { useServers } from '../stores/serverStore';
import { useTour } from '../tour/tourStore';
import { buildMenus, type MenuKey } from './menuModel';
import { openApp } from './openApp';
import { useDesktop } from './windowStore';

const STATUS_DOT: Record<string, string> = {
  connected: 'bg-success',
  connecting: 'bg-warning',
  error: 'bg-danger',
  disconnected: 'bg-faint-foreground',
};

/** A small neutral mark (a shell prompt in a rounded square). Not anyone's trademark. */
function GfvMark() {
  return (
    <svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden>
      <rect x="1" y="1" width="14" height="14" rx="4" stroke="currentColor" strokeWidth="1.6" />
      <path
        d="M4.5 6l2.5 2-2.5 2"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path d="M8.5 10.5h3" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

const BAR_BTN =
  'flex h-[22px] items-center gap-1.5 rounded px-2 text-body hover:bg-foreground/10 aria-expanded:bg-foreground/15 focus-visible:outline-offset-0';

/** A menu-bar button that opens a Menu under itself. `data-menu-trigger` lets the button toggle its own menu. */
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
  items: MenuItem[];
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
          items={items}
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
  const { setTheme, toggleTheme, focus, minimize, toggleMaximize, requestClose } =
    useDesktop.getState();
  const appearance = useAppearance();
  const { open: learnOpen, toggle: toggleLearn } = useLearn();
  const startTour = useTour((s) => s.start);
  const { servers, statuses, activeId, setActive, lock } = useServers();
  const { active: recording, refresh, start: startRec, stop: stopRec } = useRecording();

  const [open, setOpen] = useState<string | null>(null);
  const [changePw, setChangePw] = useState(false);
  const [now, setNow] = useState(() => new Date());
  useEffect(() => void refresh(), [refresh]);
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 15_000);
    return () => clearInterval(t);
  }, []);

  const activeWindow = focusedId ? windows[focusedId] : undefined;
  const activeApp = activeWindow ? appById(activeWindow.appId) : undefined;
  const server = servers.find((s) => s.id === activeId);

  const menus = useMemo(
    () =>
      buildMenus({
        activeApp,
        activeWindow,
        windows: Object.values(windows),
        theme,
        wallpaper: appearance.wallpaper,
        reduceTransparency: appearance.reduceTransparency,
        learnOpen,
        launchable: LAUNCHABLE,
        act: {
          openApp,
          closeWindow: requestClose,
          minimize,
          zoom: toggleMaximize,
          focus,
          setTheme,
          setWallpaper: appearance.setWallpaper,
          setReduceTransparency: appearance.setReduceTransparency,
          toggleLearn,
          tour: startTour,
          changePassword: () => setChangePw(true),
          lock: () => void lock(),
        },
      }),
    [activeApp, activeWindow, windows, theme, appearance, learnOpen],
  );

  const ORDER: MenuKey[] = ['file', 'view', 'window', 'help'];
  const keys = ['gfv', ...ORDER] as MenuKey[];
  const step = (from: MenuKey) => (dir: 1 | -1) =>
    setOpen(`m:${keys[(keys.indexOf(from) + dir + keys.length) % keys.length]}`);
  const TITLES: Record<MenuKey, string> = {
    gfv: 'GFV',
    file: 'File',
    view: 'View',
    window: 'Window',
    help: 'Help',
  };

  const serverItems: MenuItem[] = [
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
          items={menus.gfv}
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
            items={menus[k]}
            ariaLabel={`${TITLES[k]} menu`}
            onNavigate={step(k)}
          >
            {TITLES[k]}
          </BarMenu>
        ))}
      </nav>

      <div className="flex items-center gap-0.5">
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
            onClick={() => {
              void stopRec().then((id) => id && openApp(appById('recipes')!));
            }}
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
            onClick={() => activeId && void startRec(activeId)}
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
        <button
          aria-label="Lock vault"
          title="Lock (disconnects all servers)"
          className={BAR_BTN}
          onClick={() => void lock()}
        >
          <Lock size={13} />
        </button>
        <button
          aria-label="Toggle theme"
          title="Light / dark"
          className={BAR_BTN}
          onClick={toggleTheme}
        >
          {theme === 'dark' ? <Moon size={13} /> : <Sun size={14} />}
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
      {changePw && <ChangePasswordDialog onClose={() => setChangePw(false)} />}
    </header>
  );
}
