import { useRef, useState } from 'react';
import { useDesktop } from '../../desktop/windowStore';
import { cn } from '../../lib/utils';
import { useServers } from '../../stores/serverStore';
import { TerminalView } from './TerminalView';

interface Tab {
  id: number;
  title: string;
}

/**
 * Tabbed terminal. Tabs stay mounted (just hidden) so their shells keep running while you
 * look at another tab or minimize the window. The window is tied to one server.
 */
export function TerminalApp({ windowId }: { windowId: string }) {
  const serverId = useDesktop((s) => s.windows[windowId]?.serverId);
  const server = useServers((s) => s.servers.find((x) => x.id === serverId));
  const closeWindow = useDesktop((s) => s.close);
  const counter = useRef(1);
  const [tabs, setTabs] = useState<Tab[]>([{ id: 1, title: 'Shell 1' }]);
  const [activeId, setActiveId] = useState(1);

  if (!serverId || !server) {
    return (
      <div className="grid h-full place-items-center p-4 text-center text-sm text-muted-foreground">
        This terminal needs a server. Add one in the Servers app, pick it in the taskbar, then open
        a new Terminal.
      </div>
    );
  }

  const add = () => {
    const id = ++counter.current;
    setTabs((t) => [...t, { id, title: `Shell ${id}` }]);
    setActiveId(id);
  };

  const close = (id: number) => {
    if (tabs.length === 1) return closeWindow(windowId); // closing the last tab closes the window
    const idx = tabs.findIndex((t) => t.id === id);
    const next = tabs.filter((t) => t.id !== id);
    setTabs(next);
    if (activeId === id) setActiveId(next[Math.max(0, idx - 1)]!.id);
  };

  return (
    <div className="flex h-full flex-col bg-[#0b1020] text-slate-200">
      <div
        role="tablist"
        className="flex shrink-0 items-center gap-1 border-b border-slate-700 bg-slate-900 px-1 pt-1 text-xs"
      >
        {tabs.map((t) => (
          <div
            key={t.id}
            className={cn(
              'flex items-center gap-1 rounded-t px-3 py-1',
              t.id === activeId ? 'bg-[#0b1020]' : 'text-slate-400 hover:bg-slate-800',
            )}
          >
            <button role="tab" aria-selected={t.id === activeId} onClick={() => setActiveId(t.id)}>
              {t.title}
            </button>
            <button
              aria-label={`Close ${t.title}`}
              className="px-1 opacity-60 hover:opacity-100"
              onClick={() => close(t.id)}
            >
              ✕
            </button>
          </div>
        ))}
        <button aria-label="New tab" className="rounded px-2 py-1 hover:bg-slate-800" onClick={add}>
          +
        </button>
      </div>

      <div className="min-h-0 flex-1">
        {tabs.map((t) => (
          <div key={t.id} className={t.id === activeId ? 'h-full' : 'hidden'}>
            <TerminalView serverId={serverId} windowId={windowId} active={t.id === activeId} />
          </div>
        ))}
      </div>
    </div>
  );
}
