import { Circle, GraduationCap, LayoutGrid, Lock, Moon, Sun, Blend } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useAppearance } from '../stores/appearanceStore';
import { useLearn } from '../stores/learnStore';
import { useRecording } from '../stores/recordingStore';
import { useServers } from '../stores/serverStore';
import { commands } from './commands';
import { openApp } from './openApp';
import { useOverlays } from './overlayStore';
import { WALLPAPERS } from './wallpapers';
import { useDesktop } from './windowStore';
import { appById } from '../apps/registry';

const DOT: Record<string, string> = {
  connected: 'bg-success',
  connecting: 'bg-warning',
  error: 'bg-danger',
  disconnected: 'bg-faint-foreground',
};

/** A square toggle: filled with the accent colour while on. */
function Tile({
  icon,
  label,
  on,
  onClick,
  disabled,
  pressed,
}: {
  icon: React.ReactNode;
  label: string;
  on?: boolean;
  onClick: () => void;
  disabled?: boolean;
  /** Set for real toggles (adds aria-pressed). Plain buttons leave it out. */
  pressed?: boolean;
}) {
  return (
    <button
      aria-pressed={pressed ? !!on : undefined}
      disabled={disabled}
      onClick={onClick}
      className={`flex h-16 flex-col items-start justify-between rounded-xl p-2.5 text-left text-footnote font-medium transition-colors disabled:opacity-40 ${
        on ? 'bg-primary text-primary-foreground' : 'bg-foreground/[0.06] hover:bg-foreground/10'
      }`}
    >
      {icon}
      {label}
    </button>
  );
}

/** A panel of the settings people reach for most: server, theme, wallpaper, Learn, Record, lock. */
export function ControlCenter() {
  const open = useOverlays((s) => s.controlCenter);
  const setOpen = useOverlays((s) => s.setControlCenter);
  const ref = useRef<HTMLDivElement>(null);
  const theme = useDesktop((s) => s.theme);
  const setTheme = useDesktop((s) => s.setTheme);
  const { servers, statuses, activeId, setActive } = useServers();
  const appearance = useAppearance();
  const learnOpen = useLearn((s) => s.open);
  const toggleLearn = useLearn((s) => s.toggle);
  const recording = useRecording((s) => s.active);

  useEffect(() => {
    if (!open) return;
    ref.current?.querySelector<HTMLElement>('button')?.focus();
    const down = (e: PointerEvent) => {
      const t = e.target as Element | null;
      if (ref.current?.contains(t) || t?.closest('[data-menu-trigger]')) return;
      setOpen(false);
    };
    const key = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    window.addEventListener('pointerdown', down, true);
    window.addEventListener('keydown', key);
    return () => {
      window.removeEventListener('pointerdown', down, true);
      window.removeEventListener('keydown', key);
    };
  }, [open, setOpen]);

  if (!open) return null;
  const close =
    <T extends unknown[]>(fn: (...a: T) => void) =>
    (...a: T) => {
      setOpen(false);
      fn(...a);
    };

  return createPortal(
    <div
      ref={ref}
      role="dialog"
      aria-label="Control Center"
      className="glass-popover cc-in fixed z-[200000] w-[320px] rounded-2xl border border-separator p-3 text-body text-foreground shadow-elev-3"
      style={{ top: 'calc(var(--menubar-h) + 6px)', right: 8 }}
    >
      <section aria-label="Servers" className="rounded-xl bg-foreground/[0.06] p-2">
        <p className="px-1 pb-1 text-caption font-medium text-faint-foreground">Server</p>
        {servers.length === 0 && (
          <button
            className="w-full rounded-lg px-2 py-1.5 text-left text-link hover:bg-foreground/10"
            onClick={close(() => openApp(appById('servers')!))}
          >
            Add a server…
          </button>
        )}
        {servers.map((s) => (
          <button
            key={s.id}
            role="radio"
            aria-checked={s.id === activeId}
            className={`flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left hover:bg-foreground/10 ${
              s.id === activeId ? 'bg-foreground/10 font-medium' : ''
            }`}
            onClick={() => setActive(s.id)}
          >
            <span className={`h-2 w-2 rounded-full ${DOT[statuses[s.id] ?? 'disconnected']}`} />
            <span className="flex-1 truncate">{s.name}</span>
            <span className="h-3 w-3 rounded-sm" style={{ background: s.color }} />
          </button>
        ))}
      </section>

      <div className="mt-2 grid grid-cols-2 gap-2">
        <div
          role="group"
          aria-label="Appearance"
          className="col-span-2 flex rounded-xl bg-foreground/[0.06] p-1"
        >
          {(['light', 'dark'] as const).map((t) => (
            <button
              key={t}
              aria-pressed={theme === t}
              onClick={() => setTheme(t)}
              className={`flex flex-1 items-center justify-center gap-1.5 rounded-lg py-1.5 ${
                theme === t ? 'bg-background shadow-elev-1' : 'hover:bg-foreground/10'
              }`}
            >
              {t === 'light' ? <Sun size={14} /> : <Moon size={14} />}
              {t === 'light' ? 'Light' : 'Dark'}
            </button>
          ))}
        </div>

        <Tile
          pressed
          on={learnOpen}
          onClick={toggleLearn}
          icon={<GraduationCap size={18} />}
          label="Learn Mode"
        />
        <Tile
          pressed
          on={!!recording}
          disabled={!recording && !activeId}
          onClick={() => void commands.toggleRecording()}
          icon={<Circle size={16} fill="currentColor" className={recording ? '' : 'text-danger'} />}
          label={recording ? `Recording (${recording.stepCount})` : 'Record'}
        />
        <Tile
          pressed
          on={appearance.reduceTransparency}
          onClick={() => appearance.setReduceTransparency(!appearance.reduceTransparency)}
          icon={<Blend size={18} />}
          label="Reduce Transparency"
        />
        <Tile
          onClick={close(commands.missionControl)}
          icon={<LayoutGrid size={18} />}
          label="Mission Control"
        />
      </div>

      <section aria-label="Wallpaper" className="mt-2 rounded-xl bg-foreground/[0.06] p-2">
        <p className="px-1 pb-1.5 text-caption font-medium text-faint-foreground">Wallpaper</p>
        <div className="grid grid-cols-4 gap-2">
          {WALLPAPERS.map((w) => (
            <button
              key={w.id}
              aria-label={`Wallpaper ${w.name}`}
              aria-pressed={appearance.wallpaper === w.id}
              title={w.name}
              onClick={() => appearance.setWallpaper(w.id)}
              className={`h-10 rounded-lg border border-separator ${
                appearance.wallpaper === w.id
                  ? 'ring-2 ring-ring ring-offset-1 ring-offset-transparent'
                  : ''
              }`}
              style={{ background: theme === 'dark' ? w.dark : w.light }}
            />
          ))}
        </div>
      </section>

      <div className="mt-2 flex gap-2">
        <button
          className="flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-foreground/[0.06] py-2 hover:bg-foreground/10"
          onClick={close(commands.lock)}
        >
          <Lock size={14} /> Lock Vault
        </button>
        <button
          className="flex-1 rounded-xl bg-foreground/[0.06] py-2 hover:bg-foreground/10"
          onClick={close(commands.tour)}
        >
          Take the Tour
        </button>
      </div>
    </div>,
    document.body,
  );
}
