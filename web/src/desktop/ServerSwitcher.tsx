import { useState } from 'react';
import { useServers } from '../stores/serverStore';

const DOT: Record<string, string> = {
  connected: 'bg-green-500',
  connecting: 'bg-amber-400',
  error: 'bg-red-500',
  disconnected: 'bg-slate-400',
};

/** Taskbar dropdown: pick which server new windows are tied to. */
export function ServerSwitcher({ onManage }: { onManage: () => void }) {
  const { servers, statuses, activeId, setActive } = useServers();
  const [open, setOpen] = useState(false);
  const active = servers.find((s) => s.id === activeId);

  return (
    <div className="relative">
      <button
        aria-haspopup="menu"
        aria-expanded={open}
        className="flex items-center gap-2 rounded border border-slate-400/60 px-2 py-1 text-xs hover:bg-slate-300/60 dark:hover:bg-slate-700"
        style={active ? { borderColor: active.color } : undefined}
        onClick={() => setOpen((o) => !o)}
      >
        <span
          className={`h-2 w-2 rounded-full ${DOT[active ? (statuses[active.id] ?? 'disconnected') : 'disconnected']}`}
        />
        {active ? active.name : 'no server'} ▾
      </button>
      {open && (
        <div
          role="menu"
          className="absolute bottom-10 left-0 w-56 rounded-lg border border-slate-300 bg-white p-1 shadow-xl dark:border-slate-700 dark:bg-slate-900"
        >
          {servers.map((s) => (
            <button
              key={s.id}
              role="menuitem"
              className="flex w-full items-center gap-2 rounded px-3 py-2 text-left text-sm hover:bg-slate-200 dark:hover:bg-slate-800"
              onClick={() => {
                setActive(s.id);
                setOpen(false);
              }}
            >
              <span className={`h-2 w-2 rounded-full ${DOT[statuses[s.id] ?? 'disconnected']}`} />
              <span className="flex-1 truncate">{s.name}</span>
              <span className="h-3 w-3 rounded-sm" style={{ background: s.color }} />
            </button>
          ))}
          <button
            role="menuitem"
            className="w-full rounded px-3 py-2 text-left text-sm text-sky-600 hover:bg-slate-200 dark:text-sky-400 dark:hover:bg-slate-800"
            onClick={() => {
              setOpen(false);
              onManage();
            }}
          >
            Manage servers…
          </button>
        </div>
      )}
    </div>
  );
}
