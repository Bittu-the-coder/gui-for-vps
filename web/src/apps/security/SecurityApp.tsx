import {
  evaluate,
  parseAudit,
  parseBackups,
  type AuditFacts,
  type FirewallBackup,
  type Finding,
  type Severity,
} from '@gfv/shared';
import { Check, RefreshCw, ShieldAlert, Undo2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { CommandsDisclosure } from '../../components/CommandsDisclosure';
import { NoServer, queryProblem } from '../../components/NoServer';
import { Button } from '../../components/ui/button';
import { openApp } from '../../desktop/openApp';
import { useDesktop } from '../../desktop/windowStore';
import { api } from '../../lib/api';
import { requestRun } from '../../runner/runStore';
import { appById } from '../registry';

const BADGE: Record<Severity, string> = {
  high: 'bg-danger/10 text-danger',
  medium: 'bg-warning/10 text-warning',
  low: 'bg-primary/10 text-link',
  info: 'bg-foreground/10 text-muted-foreground',
};
const LABEL: Record<Severity, string> = {
  high: 'Fix soon',
  medium: 'Worth fixing',
  low: 'Nice to have',
  info: 'For your information',
};

/** A read-only checkup of the server, with a one-click fix for what can be fixed safely. */
export function SecurityApp({ windowId }: { windowId: string }) {
  const win = useDesktop((s) => s.windows[windowId]);
  const serverId = win?.serverId;
  const [facts, setFacts] = useState<AuditFacts | null>(null);
  const [undo, setUndo] = useState<FirewallBackup[]>([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const load = async () => {
    if (!serverId) return;
    setBusy(true);
    try {
      const r = await api.query(serverId, 'security.audit');
      const problem = queryProblem(r.exitCode, r.stderr, 'the checkup');
      setError(problem ?? '');
      if (!problem) setFacts(parseAudit(r.stdout));
      const b = await api.query(serverId, 'firewall.backups');
      if (b.exitCode === 0) setUndo(parseBackups(b.stdout).filter((x) => x.kind === 'sshd'));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'The checkup failed.');
    } finally {
      setBusy(false);
    }
  };
  useEffect(() => {
    void load();
  }, [serverId]);

  if (!serverId) return <NoServer app="Security checkup" />;

  const findings = facts ? evaluate(facts) : [];
  const problems = findings.filter((f) => f.severity !== 'info');

  const fix = (f: Finding) => {
    const x = f.fix;
    if (!x) return;
    if (x.kind === 'app') {
      const app = appById(x.appId);
      if (app) openApp(app);
    } else
      requestRun({
        serverId,
        actionId: x.actionId,
        params: x.params ?? {},
        onDone: () => void load(),
      });
  };

  return (
    <div className="flex h-full flex-col text-body">
      <div className="flex shrink-0 items-center gap-2 border-b border-border p-2">
        {!facts ? (
          <span className="text-muted-foreground">
            {busy ? 'Checking this server…' : 'Not checked yet'}
          </span>
        ) : problems.length === 0 ? (
          <>
            <Check size={18} className="text-success" />
            <span data-testid="sec-summary" className="font-medium">
              No problems found
            </span>
          </>
        ) : (
          <>
            <ShieldAlert size={18} className="text-warning" />
            <span data-testid="sec-summary" className="font-medium">
              {problems.length} thing{problems.length === 1 ? '' : 's'} to look at
            </span>
          </>
        )}
        <Button
          size="sm"
          variant="outline"
          className="ml-auto"
          disabled={busy}
          onClick={() => void load()}
        >
          <RefreshCw size={13} className={busy ? 'animate-spin' : ''} /> Check again
        </Button>
      </div>

      {error && (
        <p role="alert" className="p-3 text-danger">
          {error}
        </p>
      )}

      <div className="min-h-0 flex-1 overflow-auto p-2">
        <ul className="flex flex-col gap-2">
          {facts && findings.length === 0 && !error && (
            <li className="p-4 text-center text-muted-foreground">
              Everything GFV checks looks fine: SSH, firewall, updates, accounts and disk. This is a
              checklist of common problems, not a guarantee.
            </li>
          )}
          {findings.map((f) => (
            <li
              key={f.id}
              data-testid="sec-finding"
              data-id={f.id}
              className="rounded-xl border border-separator p-3"
            >
              <div className="flex flex-wrap items-center gap-2">
                <span className={`rounded-full px-2 py-px text-caption ${BADGE[f.severity]}`}>
                  {LABEL[f.severity]}
                </span>
                <span className="min-w-0 flex-1 font-medium">{f.title}</span>
                {f.fix && (
                  <Button
                    size="sm"
                    variant={f.severity === 'high' ? 'default' : 'outline'}
                    onClick={() => fix(f)}
                  >
                    {f.fix.label}
                  </Button>
                )}
              </div>
              <p className="mt-1 text-footnote text-muted-foreground">{f.detail}</p>
            </li>
          ))}
        </ul>

        {undo.length > 0 && (
          <section className="mt-4">
            <h3 className="mb-1 text-caption font-semibold uppercase tracking-wide text-faint-foreground">
              Recent SSH changes
            </h3>
            <ul className="flex flex-col gap-1">
              {undo.slice(0, 5).map((b) => (
                <li
                  key={b.id}
                  data-testid="sec-undo"
                  className="flex items-center gap-2 rounded-lg border border-separator p-2"
                >
                  <span className="min-w-0 flex-1 truncate text-footnote">
                    {b.title} · {new Date(b.at * 1000).toLocaleString()}
                    {b.reverted && <span className="text-warning"> · undone automatically</span>}
                  </span>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() =>
                      requestRun({
                        serverId,
                        actionId: 'security.ssh.restore',
                        params: { backup: b.id },
                        onDone: () => void load(),
                      })
                    }
                  >
                    <Undo2 size={13} /> Undo
                  </Button>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
      <CommandsDisclosure serverId={serverId} actions={[{ id: 'security.audit' }]} />
    </div>
  );
}
