import { useEffect, useState } from 'react';
import { appById } from '../apps/registry';
import { useLearn } from '../stores/learnStore';
import { useServers } from '../stores/serverStore';
import { openApp } from './openApp';
import { ServerSwitcher } from './ServerSwitcher';
import { StartMenu } from './StartMenu';
import { useDesktop } from './windowStore';

export function Taskbar() {
  const { windows, focusedId, focus, minimize, theme, toggleTheme } = useDesktop();
  const lock = useServers((s) => s.lock);
  const { open: learnOpen, toggle: toggleLearn } = useLearn();
  const [menu, setMenu] = useState(false);
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 15_000);
    return () => clearInterval(t);
  }, []);

  const list = Object.values(windows).sort((a, b) => a.id.localeCompare(b.id));
  const btn = 'rounded px-2 py-1 hover:bg-slate-300/60 dark:hover:bg-slate-700';

  return (
    <div
      className="absolute inset-x-0 bottom-0 z-[100000] flex h-11 items-center gap-2 border-t border-slate-300 bg-slate-100/95 px-2 text-sm dark:border-slate-700 dark:bg-slate-900/95"
      onMouseDown={(e) => e.stopPropagation()}
    >
      <div className="relative">
        <button className={`${btn} px-3 font-semibold`} onClick={() => setMenu((m) => !m)}>
          ⊞ Start
        </button>
        {menu && <StartMenu onClose={() => setMenu(false)} />}
      </div>

      <ServerSwitcher onManage={() => openApp(appById('servers')!)} />

      <div className="flex min-w-0 flex-1 gap-1 overflow-x-auto">
        {list.map((w) => {
          const active = focusedId === w.id && !w.minimized;
          return (
            <button
              key={w.id}
              className={`max-w-40 truncate rounded px-3 py-1 ${
                active ? 'bg-sky-500/30' : 'hover:bg-slate-300/60 dark:hover:bg-slate-700'
              } ${w.minimized ? 'opacity-60' : ''}`}
              onClick={() => (active ? minimize(w.id) : focus(w.id))}
            >
              {w.title}
            </button>
          );
        })}
      </div>

      <button
        aria-label="Toggle Learn Mode"
        aria-pressed={learnOpen}
        title="Learn Mode: see the commands behind every action"
        className={`${btn} ${learnOpen ? 'bg-sky-500/30' : ''}`}
        onClick={toggleLearn}
      >
        🎓 Learn
      </button>
      <button
        aria-label="Lock vault"
        title="Lock (disconnects all servers)"
        className={btn}
        onClick={() => void lock()}
      >
        🔒
      </button>
      <button aria-label="Toggle theme" className={btn} onClick={toggleTheme}>
        {theme === 'dark' ? '🌙' : '☀️'}
      </button>
      <span className="tabular-nums">
        {now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
      </span>
    </div>
  );
}
