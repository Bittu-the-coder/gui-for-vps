import { useEffect } from 'react';
import { CommandLine } from '../components/CommandLine';
import { RiskBadge } from '../components/RiskBadge';
import { useLearn } from '../stores/learnStore';
import { useServers } from '../stores/serverStore';

/** Right-hand dock: command journal + "You've learned N commands". */
export function LearnPanel() {
  const { entries, learned, refresh } = useLearn();
  const servers = useServers((s) => s.servers);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return (
    <aside
      aria-label="Learn Mode"
      className="absolute bottom-0 right-0 top-[var(--menubar-h)] z-[99990] flex w-80 flex-col border-l border-slate-300 bg-slate-50/95 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-900/95 dark:text-slate-100"
      onMouseDown={(e) => e.stopPropagation()}
    >
      <header className="border-b border-slate-300 p-3 dark:border-slate-700">
        <h2 className="font-semibold">🎓 Learn Mode</h2>
        <p className="text-xs text-slate-600 dark:text-slate-400">
          You&apos;ve learned <strong data-testid="learned-count">{learned.length}</strong>{' '}
          {learned.length === 1 ? 'command' : 'commands'}
        </p>
        {learned.length > 0 && (
          <p className="mt-1 flex flex-wrap gap-1">
            {learned.map((n) => (
              <code key={n} className="rounded bg-slate-200 px-1 text-[11px] dark:bg-slate-800">
                {n}
              </code>
            ))}
          </p>
        )}
      </header>
      <div className="min-h-0 flex-1 overflow-auto p-3">
        <h3 className="mb-2 text-xs font-semibold uppercase text-slate-500">Command journal</h3>
        {entries.length === 0 && (
          <p className="text-xs text-slate-500">
            Nothing yet. Run an action and every command GFV runs for you shows up here, with an
            explanation.
          </p>
        )}
        <ul className="flex flex-col gap-3">
          {entries.map((e) => {
            const server = servers.find((s) => s.id === e.serverId);
            return (
              <li key={e.id} className="rounded border border-slate-300 p-2 dark:border-slate-700">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="font-medium">{e.title}</span>
                  <RiskBadge risk={e.risk} />
                  <span
                    className={`text-[10px] ${e.exitCode === 0 ? 'text-emerald-600' : 'text-red-500'}`}
                  >
                    {e.exitCode === 0 ? '✓ ok' : `✗ exit ${e.exitCode ?? '?'}`}
                  </span>
                </div>
                <div className="text-[10px] text-slate-500">
                  {server?.name ?? 'deleted server'} · {new Date(e.startedAt).toLocaleTimeString()}
                </div>
                {e.explain && <p className="my-1 text-xs">{e.explain}</p>}
                <div className="mt-1 flex flex-col gap-1">
                  {e.commands.map((c, i) => (
                    <CommandLine key={i} command={c} serverId={e.serverId} />
                  ))}
                </div>
              </li>
            );
          })}
        </ul>
      </div>
    </aside>
  );
}
