import { parsePorts, parseSites, type ListeningPort, type NginxSite } from '@gfv/shared';
import { Globe, Lock, Plus } from 'lucide-react';
import { useState } from 'react';
import { CommandsDisclosure } from '../../components/CommandsDisclosure';
import { NoServer, queryProblem } from '../../components/NoServer';
import { Button } from '../../components/ui/button';
import { useDesktop } from '../../desktop/windowStore';
import { usePolling } from '../../hooks/usePolling';
import { api } from '../../lib/api';
import { confirmDialog } from '../../components/confirmStore';
import { requestRun } from '../../runner/runStore';
import { SiteDialog } from './SiteDialog';

const isPublic = (p: ListeningPort) => ['0.0.0.0', '::', '*'].includes(p.address);

/** What is listening on this server, and the nginx sites (domains) that point at your apps. */
export function NetworkApp({ windowId }: { windowId: string }) {
  const win = useDesktop((s) => s.windows[windowId]);
  const serverId = win?.serverId;
  const active = !!serverId && !win?.minimized;
  const [tab, setTab] = useState<'ports' | 'sites'>('ports');
  const [ports, setPorts] = useState<ListeningPort[]>([]);
  const [noSs, setNoSs] = useState(false);
  const [sites, setSites] = useState<NginxSite[]>([]);
  const [noNginx, setNoNginx] = useState(false);
  const [error, setError] = useState('');
  const [adding, setAdding] = useState(false);
  const [https, setHttps] = useState<string | null>(null);

  const loadPorts = async () => {
    const r = await api.query(serverId!, 'ports.list');
    const problem = queryProblem(r.exitCode, r.stderr, 'ss');
    setError(problem ?? '');
    setNoSs(r.stdout.includes('NO_SS'));
    if (!problem) setPorts(parsePorts(r.stdout));
  };
  const loadSites = async () => {
    const r = await api.query(serverId!, 'nginx.sites.list');
    const problem = queryProblem(r.exitCode, r.stderr, 'nginx');
    setError(problem ?? '');
    setNoNginx(r.stdout.includes('NO_NGINX'));
    if (!problem) setSites(parseSites(r.stdout));
  };
  usePolling(loadPorts, 5000, active && tab === 'ports');
  usePolling(loadSites, 5000, active && tab === 'sites');

  if (!serverId) return <NoServer app="Network" />;

  const remove = (s: NginxSite) =>
    void confirmDialog({
      title: `Remove ${s.name}?`,
      body: 'The site stops being served. Its file is backed up first (see Snapshots), so you can restore it.',
      confirmLabel: 'Review…',
    }).then(
      (ok) =>
        ok &&
        requestRun({
          serverId,
          actionId: 'nginx.site.remove',
          params: { domain: s.name },
          onDone: () => void loadSites(),
        }),
    );

  return (
    <div className="flex h-full flex-col text-body">
      <div role="tablist" className="flex shrink-0 items-center gap-1 border-b border-border p-2">
        <Button
          role="tab"
          aria-selected={tab === 'ports'}
          size="sm"
          variant={tab === 'ports' ? 'default' : 'outline'}
          onClick={() => setTab('ports')}
        >
          Ports
        </Button>
        <Button
          role="tab"
          aria-selected={tab === 'sites'}
          size="sm"
          variant={tab === 'sites' ? 'default' : 'outline'}
          onClick={() => setTab('sites')}
        >
          Sites &amp; domains
        </Button>
        {tab === 'sites' && !noNginx && (
          <Button size="sm" className="ml-auto" onClick={() => setAdding(true)}>
            <Plus size={13} /> Add site
          </Button>
        )}
      </div>

      {error && (
        <p role="alert" className="p-3 text-danger">
          {error}
        </p>
      )}

      {tab === 'ports' ? (
        <div className="min-h-0 flex-1 overflow-auto">
          {noSs ? (
            <p className="p-4 text-muted-foreground">
              The <code>ss</code> tool is not installed on this server (it is in the{' '}
              <code>iproute2</code> package).
            </p>
          ) : (
            <table className="w-full table-fixed text-footnote">
              <thead className="sticky top-0 bg-sunken text-left">
                <tr>
                  <th className="w-16 px-2 py-1">Port</th>
                  <th className="w-14 px-2 py-1">Type</th>
                  <th className="w-40 px-2 py-1">Listening on</th>
                  <th className="px-2 py-1">Program</th>
                  <th className="w-32 px-2 py-1">Reachable</th>
                </tr>
              </thead>
              <tbody>
                {ports.map((p) => (
                  <tr
                    key={`${p.proto}${p.address}${p.port}`}
                    data-testid="port-row"
                    className="border-b border-border/50 hover:bg-accent"
                  >
                    <td className="px-2 py-1 font-mono tabular-nums">{p.port}</td>
                    <td className="px-2 py-1 uppercase">{p.proto}</td>
                    <td className="truncate px-2 py-1 font-mono">{p.address}</td>
                    <td className="truncate px-2 py-1">
                      {p.process ? (
                        `${p.process} (pid ${p.pid})`
                      ) : (
                        <span className="text-muted-foreground">unknown</span>
                      )}
                    </td>
                    <td className="px-2 py-1">
                      <span
                        className={`whitespace-nowrap ${isPublic(p) ? 'text-warning' : 'text-success'}`}
                      >
                        {isPublic(p) ? 'any address' : 'this server only'}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {!noSs && ports.length === 0 && !error && (
            <p className="p-4 text-center text-muted-foreground">No listening ports found.</p>
          )}
          <p className="p-3 text-footnote text-muted-foreground">
            “Any address” means other computers can reach it unless a firewall blocks it. “This
            server only” (127.0.0.1) cannot be reached from outside.
          </p>
        </div>
      ) : (
        <div className="min-h-0 flex-1 overflow-auto p-2">
          {noNginx ? (
            <div className="p-4 text-center text-muted-foreground">
              nginx is not installed on this server. Install it from the Dev Hub, then come back to
              add sites.
            </div>
          ) : (
            <ul className="flex flex-col gap-2">
              {sites.length === 0 && (
                <li className="p-4 text-center text-muted-foreground">No sites yet.</li>
              )}
              {sites.map((s) => (
                <li
                  key={s.name}
                  data-testid="site-row"
                  className="rounded-xl border border-separator p-3"
                >
                  <div className="flex items-center gap-2">
                    <Globe size={15} className="text-link" />
                    <span className="font-medium">
                      {s.serverNames.filter((n) => n !== '_').join(', ') || s.name}
                    </span>
                    {s.https && (
                      <span className="flex items-center gap-1 rounded-full bg-success/10 px-2 text-caption text-success">
                        <Lock size={11} /> HTTPS
                      </span>
                    )}
                    <span
                      className={`rounded-full px-2 text-caption ${s.enabled ? 'bg-primary/10 text-link' : 'bg-foreground/10 text-muted-foreground'}`}
                    >
                      {s.enabled ? 'enabled' : 'disabled'}
                    </span>
                    <span className="ml-auto flex gap-1">
                      {s.managedByGfv && !s.https && (
                        <Button size="sm" variant="outline" onClick={() => setHttps(s.name)}>
                          Get HTTPS
                        </Button>
                      )}
                      {s.managedByGfv && (
                        <Button
                          size="sm"
                          variant="ghost"
                          className="text-danger"
                          onClick={() => remove(s)}
                        >
                          Remove
                        </Button>
                      )}
                    </span>
                  </div>
                  <p className="mt-0.5 text-footnote text-muted-foreground">
                    {s.target ? (
                      <>
                        serves <code>{s.target}</code>
                      </>
                    ) : (
                      'no target found'
                    )}
                    {!s.managedByGfv && ' · file not created by GFV (view only)'}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <CommandsDisclosure
        serverId={serverId}
        actions={[{ id: tab === 'ports' ? 'ports.list' : 'nginx.sites.list' }]}
      />
      {adding && (
        <SiteDialog
          serverId={serverId}
          onClose={() => setAdding(false)}
          onDone={() => void loadSites()}
        />
      )}
      {https && (
        <SiteDialog
          serverId={serverId}
          httpsFor={https}
          onClose={() => setHttps(null)}
          onDone={() => void loadSites()}
        />
      )}
    </div>
  );
}
