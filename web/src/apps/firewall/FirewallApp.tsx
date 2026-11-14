import {
  describeRule,
  matchesSsh,
  parseBackups,
  parseStatus,
  ruleSchema,
  type FirewallBackup,
  type FirewallRule,
  type FirewallStatus,
} from '@gfv/shared';
import { History, Plus, ShieldCheck, ShieldOff, Undo2 } from 'lucide-react';
import { useState } from 'react';
import { CommandsDisclosure } from '../../components/CommandsDisclosure';
import { NoServer, queryProblem } from '../../components/NoServer';
import { Button } from '../../components/ui/button';
import { confirmDialog } from '../../components/confirmStore';
import { useDesktop } from '../../desktop/windowStore';
import { usePolling } from '../../hooks/usePolling';
import { api } from '../../lib/api';
import { requestRun } from '../../runner/runStore';
import { RuleDialog } from './RuleDialog';

const BADGE: Record<FirewallRule['policy'], string> = {
  allow: 'bg-success/10 text-success',
  limit: 'bg-primary/10 text-link',
  deny: 'bg-danger/10 text-danger',
};

/** The firewall (ufw): rules, an on/off switch, and an undo timeline. Every change is guarded against lockout. */
export function FirewallApp({ windowId }: { windowId: string }) {
  const win = useDesktop((s) => s.windows[windowId]);
  const serverId = win?.serverId;
  const active = !!serverId && !win?.minimized;
  const [tab, setTab] = useState<'rules' | 'undo'>('rules');
  const [status, setStatus] = useState<FirewallStatus | null>(null);
  const [backups, setBackups] = useState<FirewallBackup[]>([]);
  const [error, setError] = useState('');
  const [adding, setAdding] = useState(false);

  const load = async () => {
    const r = await api.query(serverId!, 'firewall.status');
    const s = parseStatus(r.stdout);
    setStatus(s);
    setError(s.error ?? queryProblem(r.exitCode, r.stderr, 'ufw') ?? '');
  };
  const loadBackups = async () => {
    const r = await api.query(serverId!, 'firewall.backups');
    if (r.exitCode === 0) setBackups(parseBackups(r.stdout));
  };
  const refresh = () => void Promise.all([load(), loadBackups()]);
  usePolling(load, 5000, active);
  usePolling(loadBackups, 8000, active && tab === 'undo');

  if (!serverId) return <NoServer app="Firewall" />;

  const run = (actionId: string, params: object = {}) =>
    requestRun({ serverId, actionId, params, onDone: refresh });

  const remove = (r: FirewallRule) => {
    const spec = ruleSchema.safeParse({
      policy: r.policy,
      port: r.port,
      proto: r.proto,
      from: r.from,
    });
    if (!spec.success) return;
    void confirmDialog({
      title: `Remove “${describeRule(spec.data)}”?`,
      body: 'GFV saves the current rules first, so you can undo this from the Undo timeline.',
      confirmLabel: 'Review…',
    }).then((ok) => ok && run('firewall.delete', spec.data));
  };

  return (
    <div className="flex h-full flex-col text-body">
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-border p-2">
        {!status ? (
          <span className="text-muted-foreground">Reading the firewall…</span>
        ) : !status.installed ? (
          <>
            <ShieldOff size={18} className="text-muted-foreground" />
            <span>The firewall (ufw) is not installed on this server.</span>
            <Button size="sm" className="ml-auto" onClick={() => run('firewall.install')}>
              Install ufw
            </Button>
          </>
        ) : (
          <>
            {status.active ? (
              <ShieldCheck size={18} className="text-success" />
            ) : (
              <ShieldOff size={18} className="text-warning" />
            )}
            <span data-testid="fw-state" data-active={status.active} className="font-medium">
              Firewall is {status.active ? 'on' : 'off'}
            </span>
            {status.active && status.defaultIncoming && (
              <span className="text-footnote text-muted-foreground">
                connections without a rule are{' '}
                {status.defaultIncoming === 'deny' ? 'dropped' : status.defaultIncoming}
              </span>
            )}
            <Button
              size="sm"
              variant={status.active ? 'outline' : 'default'}
              className="ml-auto"
              onClick={() => run(status.active ? 'firewall.disable' : 'firewall.enable')}
            >
              {status.active ? 'Turn off' : 'Turn on'}
            </Button>
            <Button size="sm" onClick={() => setAdding(true)}>
              <Plus size={13} /> Add rule
            </Button>
          </>
        )}
      </div>

      <div role="tablist" className="flex shrink-0 gap-1 border-b border-border p-2">
        <Button
          role="tab"
          aria-selected={tab === 'rules'}
          size="sm"
          variant={tab === 'rules' ? 'default' : 'outline'}
          onClick={() => setTab('rules')}
        >
          Rules
        </Button>
        <Button
          role="tab"
          aria-selected={tab === 'undo'}
          size="sm"
          variant={tab === 'undo' ? 'default' : 'outline'}
          onClick={() => {
            setTab('undo');
            void loadBackups();
          }}
        >
          <History size={13} /> Undo timeline
        </Button>
      </div>

      {error && (
        <p role="alert" className="p-3 text-danger">
          {error}
        </p>
      )}

      {tab === 'rules' ? (
        <div className="min-h-0 flex-1 overflow-auto">
          {status?.installed && status.rules.length === 0 && !error && (
            <p className="p-4 text-center text-muted-foreground">
              No rules yet.{' '}
              {status.active
                ? 'Nothing can reach this server except what you allow.'
                : 'Turning the firewall on allows SSH first, so you stay connected.'}
            </p>
          )}
          {!!status?.rules.length && (
            <table className="w-full table-fixed text-footnote">
              <thead className="sticky top-0 bg-sunken text-left">
                <tr>
                  <th className="w-20 px-2 py-1">Action</th>
                  <th className="px-2 py-1">Port</th>
                  <th className="px-2 py-1">From</th>
                  <th className="w-24 px-2 py-1" />
                </tr>
              </thead>
              <tbody>
                {status.rules.map((r) => {
                  const spec = ruleSchema.safeParse({
                    policy: r.policy,
                    port: r.port,
                    proto: r.proto,
                    from: r.from,
                  });
                  const ssh =
                    spec.success &&
                    r.policy !== 'deny' &&
                    matchesSsh(spec.data, status.sshPort, status.clientIp);
                  return (
                    <tr
                      key={`${r.policy}${r.to}${r.from}${r.v6}`}
                      data-testid="fw-rule"
                      className="border-b border-border/50 hover:bg-accent"
                    >
                      <td className="px-2 py-1">
                        <span className={`rounded-full px-2 py-px text-caption ${BADGE[r.policy]}`}>
                          {r.policy}
                        </span>
                      </td>
                      <td className="truncate px-2 py-1 font-mono">
                        {r.port ? `${r.port}/${r.proto}` : 'all ports'}
                        {ssh && (
                          <span className="ml-2 font-sans text-caption text-muted-foreground">
                            (SSH: how GFV connects)
                          </span>
                        )}
                      </td>
                      <td className="truncate px-2 py-1">
                        {r.from === 'any' ? 'anywhere' : r.from}
                      </td>
                      <td className="px-2 py-1 text-right">
                        <Button
                          size="sm"
                          variant="ghost"
                          className="text-danger"
                          aria-label={`Remove rule ${describeRule(ruleSchema.parse({ policy: r.policy, port: r.port, proto: r.proto, from: r.from }))}`}
                          disabled={!spec.success}
                          onClick={() => remove(r)}
                        >
                          Remove
                        </Button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
          <p className="p-3 text-footnote text-muted-foreground">
            Safety net: before every change GFV saves the current rules on the server and starts a
            40-second timer there. After the change GFV opens a brand-new connection to prove it can
            still get in; if it cannot, the server restores the old rules by itself.
          </p>
        </div>
      ) : (
        <div className="min-h-0 flex-1 overflow-auto p-2">
          <ul className="flex flex-col gap-2">
            {backups.length === 0 && (
              <li className="p-4 text-center text-muted-foreground">
                No changes yet. Every firewall change you make appears here, with a button to undo
                it.
              </li>
            )}
            {backups.map((b) => (
              <li
                key={b.id}
                data-testid="fw-backup"
                className="flex items-center gap-2 rounded-xl border border-separator p-3"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">{b.title}</p>
                  <p className="text-footnote text-muted-foreground">
                    {new Date(b.at * 1000).toLocaleString()} ·{' '}
                    {b.reverted ? (
                      <span className="text-warning">undone automatically (it locked GFV out)</span>
                    ) : b.confirmed ? (
                      <span className="text-success">confirmed</span>
                    ) : (
                      'waiting for confirmation'
                    )}
                  </p>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  title="Put the firewall back the way it was before this change"
                  onClick={() => run('firewall.restore', { backup: b.id })}
                >
                  <Undo2 size={13} /> Undo this change
                </Button>
              </li>
            ))}
          </ul>
        </div>
      )}

      <CommandsDisclosure
        serverId={serverId}
        actions={[{ id: 'firewall.status' }, { id: 'firewall.backups' }]}
      />
      {adding && (
        <RuleDialog
          serverId={serverId}
          status={status}
          onClose={() => setAdding(false)}
          onDone={refresh}
        />
      )}
    </div>
  );
}
