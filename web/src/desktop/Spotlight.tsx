import * as Dialog from '@radix-ui/react-dialog';
import type { ActionInfo } from '@gfv/shared';
import { AppWindow, Command, Play, Search, Server } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { LAUNCHABLE, appById } from '../apps/registry';
import { AppIcon } from '../components/icons/AppIcon';
import { api } from '../lib/api';
import { requestRun } from '../runner/runStore';
import { useAppearance } from '../stores/appearanceStore';
import { useLearn } from '../stores/learnStore';
import { useRecording } from '../stores/recordingStore';
import { useServers } from '../stores/serverStore';
import { commands } from './commands';
import { toggleFullscreen, useFullscreen } from './fullscreen';
import { openApp } from './openApp';
import { useOverlays } from './overlayStore';
import {
  buildSpotlightItems,
  rankItems,
  type SpotlightGroup,
  type SpotlightItem,
} from './spotlightModel';
import { useDesktop } from './windowStore';

const GROUP_ICON: Record<SpotlightGroup, React.ReactNode> = {
  Windows: <AppWindow size={18} />,
  Apps: <AppWindow size={18} />,
  Servers: <Server size={18} />,
  Commands: <Command size={18} />,
  Actions: <Play size={18} />,
};

function Icon({ item }: { item: SpotlightItem }) {
  const app = item.appId ? appById(item.appId) : undefined;
  if (app) return <AppIcon app={app} size={26} />;
  return (
    <span className="grid h-[26px] w-[26px] place-items-center rounded-md bg-foreground/10 text-muted-foreground">
      {GROUP_ICON[item.group]}
    </span>
  );
}

/** Command palette: type to open apps, switch windows and servers, change settings, run safe actions. */
export function Spotlight() {
  const open = useOverlays((s) => s.spotlight);
  const setOpen = useOverlays((s) => s.setSpotlight);
  const desk = useDesktop();
  const servers = useServers((s) => s.servers);
  const activeId = useServers((s) => s.activeId);
  const appearance = useAppearance();
  const learnOpen = useLearn((s) => s.open);
  const fullscreen = useFullscreen();
  const recording = useRecording((s) => !!s.active);
  const [query, setQuery] = useState('');
  const [index, setIndex] = useState(0);
  const [actions, setActions] = useState<ActionInfo[]>([]);
  const listRef = useRef<HTMLDivElement>(null);
  // Hover selects a row, but only after the mouse REALLY moves: when the list re-renders under a mouse that is
  // just resting there, the browser fires a synthetic pointermove, which must not steal the keyboard selection.
  const pointer = useRef<{ x: number; y: number } | null>(null);
  const onRowMove = (e: React.PointerEvent, i: number) => {
    const base = pointer.current;
    if (!base) {
      pointer.current = { x: e.clientX, y: e.clientY };
      return;
    }
    if (Math.hypot(e.clientX - base.x, e.clientY - base.y) < 4) return;
    pointer.current = { x: e.clientX, y: e.clientY };
    setIndex(i);
  };

  // Start fresh each time it opens. (Kept apart from loading the actions: that finishing must never clear
  // what you have already typed.)
  useEffect(() => {
    if (!open) return;
    setQuery('');
    setIndex(0);
    pointer.current = null;
  }, [open]);

  // The runner's input-free actions, loaded once.
  const loaded = useRef(false);
  useEffect(() => {
    if (!open || loaded.current) return;
    loaded.current = true;
    api
      .actions()
      .then((a) => setActions(a.filter((x) => x.fields.length === 0)))
      .catch(() => {
        loaded.current = false; // try again next time
      });
  }, [open]);

  const items = useMemo(
    () =>
      buildSpotlightItems({
        launchable: LAUNCHABLE,
        windows: Object.values(desk.windows),
        servers,
        activeServerId: activeId,
        theme: desk.theme,
        wallpaper: appearance.wallpaper,
        reduceTransparency: appearance.reduceTransparency,
        learnOpen,
        fullscreen,
        recording,
        actions,
        act: {
          openApp,
          focusWindow: desk.focus,
          setActiveServer: useServers.getState().setActive,
          toggleTheme: desk.toggleTheme,
          setWallpaper: appearance.setWallpaper,
          setReduceTransparency: appearance.setReduceTransparency,
          toggleLearn: useLearn.getState().toggle,
          toggleRecording: () => void commands.toggleRecording(),
          missionControl: commands.missionControl,
          toggleFullscreen: () => void toggleFullscreen(),
          controlCenter: commands.controlCenter,
          lock: commands.lock,
          changePassword: commands.changePassword,
          tour: commands.tour,
          runAction: (serverId, actionId) => requestRun({ serverId, actionId, params: {} }),
        },
      }),
    [desk, servers, activeId, appearance, learnOpen, fullscreen, recording, actions],
  );
  const results = useMemo(() => rankItems(items, query), [items, query]);

  useEffect(() => setIndex(0), [query]);
  useEffect(() => {
    listRef.current?.querySelector(`[data-index="${index}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [index]);

  const choose = (item: SpotlightItem | undefined) => {
    if (!item || item.disabled) return;
    setOpen(false);
    // Let the palette close first, so what we open gets focus rather than the dialog's return-focus.
    setTimeout(item.run, 0);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') setIndex((i) => Math.min(results.length - 1, i + 1));
    else if (e.key === 'ArrowUp') setIndex((i) => Math.max(0, i - 1));
    else if (e.key === 'Enter') choose(results[index]);
    else return;
    e.preventDefault();
  };

  let lastGroup: SpotlightGroup | null = null;
  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[210000] bg-[var(--scrim)]" />
        <Dialog.Content
          aria-label="Spotlight"
          aria-describedby={undefined}
          className="glass-popover spotlight-in fixed left-1/2 top-[16vh] z-[210001] w-[min(580px,calc(100vw-24px))] -translate-x-1/2 overflow-hidden rounded-2xl border border-separator text-foreground shadow-elev-3 outline-none"
          onKeyDown={onKeyDown}
        >
          <Dialog.Title className="sr-only">Spotlight</Dialog.Title>
          <div className="flex items-center gap-3 border-b border-separator px-4">
            <Search size={18} className="text-faint-foreground" />
            <input
              autoFocus
              role="combobox"
              aria-expanded
              aria-controls="spotlight-list"
              aria-activedescendant={results[index] ? `sp-${results[index]!.id}` : undefined}
              aria-label="Search apps, windows, servers and commands"
              placeholder="Search apps, windows, servers, commands…"
              className="h-12 flex-1 bg-transparent text-callout outline-none placeholder:text-faint-foreground"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            <kbd className="rounded border border-separator px-1.5 py-0.5 text-caption text-faint-foreground">
              esc
            </kbd>
          </div>
          <div
            ref={listRef}
            id="spotlight-list"
            role="listbox"
            className="max-h-[min(380px,50vh)] overflow-y-auto p-1.5"
          >
            {results.length === 0 && (
              <p className="px-3 py-8 text-center text-body text-muted-foreground">
                Nothing matches “{query}”.
              </p>
            )}
            {results.map((item, i) => {
              const header = item.group !== lastGroup;
              lastGroup = item.group;
              return (
                <div key={item.id}>
                  {header && !query.trim() && (
                    <div className="px-2.5 pb-1 pt-2 text-caption font-medium text-faint-foreground">
                      {item.group}
                    </div>
                  )}
                  <div
                    id={`sp-${item.id}`}
                    role="option"
                    aria-selected={i === index}
                    aria-disabled={item.disabled || undefined}
                    data-index={i}
                    onPointerMove={(e) => onRowMove(e, i)}
                    onClick={() => choose(item)}
                    className={`flex h-11 cursor-default items-center gap-3 rounded-lg px-2.5 ${
                      i === index ? 'bg-primary text-primary-foreground' : ''
                    } ${item.disabled ? 'opacity-45' : ''}`}
                  >
                    <Icon item={item} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-body">{item.title}</span>
                      {item.subtitle && (
                        <span
                          className={`block truncate text-caption ${i === index ? 'opacity-80' : 'text-faint-foreground'}`}
                        >
                          {item.subtitle}
                        </span>
                      )}
                    </span>
                    {query.trim() && (
                      <span
                        className={`text-caption ${i === index ? 'opacity-80' : 'text-faint-foreground'}`}
                      >
                        {item.group}
                      </span>
                    )}
                    {item.hint && (
                      <span
                        className={`rounded px-1.5 text-caption ${i === index ? 'bg-white/25' : 'bg-foreground/10 text-muted-foreground'}`}
                      >
                        {item.hint}
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
