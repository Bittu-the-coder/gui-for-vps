import { Check, GraduationCap, X } from 'lucide-react';
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
      className="glass-chrome absolute bottom-0 right-0 top-[var(--menubar-h)] z-[99990] flex w-80 flex-col border-l border-separator text-body text-foreground"
      onMouseDown={(e) => e.stopPropagation()}
    >
      <header className="border-b border-separator p-3">
        <h2 className="flex items-center gap-2 text-title font-semibold">
          <GraduationCap size={18} className="text-link" /> Learn Mode
        </h2>
        <p className="mt-0.5 text-footnote text-muted-foreground">
          You&apos;ve learned <strong data-testid="learned-count">{learned.length}</strong>{' '}
          {learned.length === 1 ? 'command' : 'commands'}
        </p>
        {learned.length > 0 && (
          <p className="mt-2 flex flex-wrap gap-1">
            {learned.map((n) => (
              <code
                key={n}
                className="rounded-md bg-foreground/10 px-1.5 py-px font-mono text-caption"
              >
                {n}
              </code>
            ))}
          </p>
        )}
      </header>
      <div className="min-h-0 flex-1 overflow-auto p-3">
        <h3 className="mb-2 text-caption font-semibold uppercase tracking-wide text-faint-foreground">
          Command journal
        </h3>
        {entries.length === 0 && (
          <p className="text-footnote text-muted-foreground">
            Nothing yet. Run an action and every command GFV runs for you shows up here, with an
            explanation.
          </p>
        )}
        <ul className="flex flex-col gap-2.5">
          {entries.map((e) => {
            const server = servers.find((s) => s.id === e.serverId);
            const ok = e.exitCode === 0;
            return (
              <li key={e.id} className="rounded-xl border border-separator bg-background p-3">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="font-medium">{e.title}</span>
                  <RiskBadge risk={e.risk} />
                  <span
                    className={`flex items-center gap-0.5 text-caption font-medium ${ok ? 'text-success' : 'text-danger'}`}
                  >
                    {ok ? <Check size={12} strokeWidth={3} /> : <X size={12} strokeWidth={3} />}
                    {ok ? 'ok' : `exit ${e.exitCode ?? '?'}`}
                  </span>
                </div>
                <div className="text-caption text-muted-foreground">
                  {server?.name ?? 'deleted server'} · {new Date(e.startedAt).toLocaleTimeString()}
                </div>
                {e.explain && <p className="my-1.5 text-footnote">{e.explain}</p>}
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
