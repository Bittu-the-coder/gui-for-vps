import { useEffect, useState } from 'react';
import { appById } from '../apps/registry';
import { useLearn } from '../stores/learnStore';
import { useRecording } from '../stores/recordingStore';
import { useServers } from '../stores/serverStore';
import { openApp } from './openApp';
import { ServerSwitcher } from './ServerSwitcher';
import { ChangePasswordDialog } from '../components/ChangePasswordDialog';
import { StartMenu } from './StartMenu';
import { useDesktop } from './windowStore';

export function Taskbar() {
  const { windows, focusedId, focus, minimize, theme, toggleTheme } = useDesktop();
  const lock = useServers((s) => s.lock);
  const { open: learnOpen, toggle: toggleLearn } = useLearn();
  const {
    active: recording,
    refresh: refreshRecording,
    start: startRec,
    stop: stopRec,
  } = useRecording();
  const { activeId, servers } = useServers();
  const [menu, setMenu] = useState(false);
  const [changePw, setChangePw] = useState(false);
  const [now, setNow] = useState(() => new Date());

  useEffect(() => void refreshRecording(), [refreshRecording]);

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
        {menu && (
          <StartMenu onClose={() => setMenu(false)} onChangePassword={() => setChangePw(true)} />
        )}
      </div>

      <div data-tour="server-switcher">
        <ServerSwitcher onManage={() => openApp(appById('servers')!)} />
      </div>

      <div className="flex min-w-0 flex-1 gap-1 overflow-x-auto">
        {list.map((w) => {
          const active = focusedId === w.id && !w.minimized;
          return (
            <button
              key={w.id}
              data-win-anchor={w.id}
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

      {recording ? (
        <button
          data-tour="record"
          aria-label="Stop recording"
          title={`Recording "${recording.name}" on ${servers.find((x) => x.id === recording.serverId)?.name ?? 'a server'}`}
          className={`${btn} flex items-center gap-1 bg-red-500/20 text-red-600 dark:text-red-300`}
          onClick={() => {
            void stopRec().then((id) => {
              if (id) openApp(appById('recipes')!);
            });
          }}
        >
          <span className="animate-pulse">⏺</span> ■ Stop ({recording.stepCount})
        </button>
      ) : (
        <button
          data-tour="record"
          aria-label="Start recording"
          title="Record the actions you run so you can export them as a bash script"
          disabled={!activeId}
          className={`${btn} disabled:opacity-40`}
          onClick={() => activeId && void startRec(activeId)}
        >
          ⏺ Record
        </button>
      )}
      <button
        data-tour="learn"
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
      {changePw && <ChangePasswordDialog onClose={() => setChangePw(false)} />}
    </div>
  );
}
