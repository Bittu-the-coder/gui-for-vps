import { parseServices, type ServiceInfo } from '@gfv/shared';
import { useMemo, useState } from 'react';
import { CommandsDisclosure } from '../../components/CommandsDisclosure';
import { LogPanel } from '../../components/LogPanel';
import { NoServer, queryProblem } from '../../components/NoServer';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { useDesktop } from '../../desktop/windowStore';
import { usePolling } from '../../hooks/usePolling';
import { api } from '../../lib/api';
import { requestRun } from '../../runner/runStore';

type Filter = 'all' | 'running' | 'failed' | 'inactive';
const dot = (s: ServiceInfo) =>
  s.active === 'failed' ? 'bg-red-500' : s.active === 'active' ? 'bg-emerald-500' : 'bg-slate-400';

export function ServicesApp({ windowId }: { windowId: string }) {
  const win = useDesktop((s) => s.windows[windowId]);
  const serverId = win?.serverId;
  const active = !!serverId && !win?.minimized;
  const [services, setServices] = useState<ServiceInfo[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [logUnit, setLogUnit] = useState<string | null>(null);

  const load = async () => {
    const r = await api.query(serverId!, 'services.list');
    const problem = queryProblem(r.exitCode, r.stderr, 'systemctl');
    setError(problem ?? '');
    if (!problem) setServices(parseServices(r.stdout));
    setLoaded(true);
  };
  usePolling(load, 5000, active);

  const shown = useMemo(() => {
    const q = search.trim().toLowerCase();
    return services.filter(
      (s) =>
        (!q || `${s.unit} ${s.description}`.toLowerCase().includes(q)) &&
        (filter === 'all' ||
          (filter === 'running' && s.active === 'active') ||
          (filter === 'failed' && s.active === 'failed') ||
          (filter === 'inactive' && s.active === 'inactive')),
    );
  }, [services, search, filter]);

  if (!serverId) return <NoServer app="Services" />;

  const act = (verb: string, unit: string) =>
    requestRun({
      serverId,
      actionId: `service.${verb}`,
      params: { unit },
      onDone: () => void load(),
    });
  const b = 'h-6 px-1.5 text-[11px]';

  return (
    <div className="flex h-full flex-col text-sm">
      <div className="flex shrink-0 items-center gap-2 border-b border-border p-1.5">
        <Input
          aria-label="Search services"
          className="h-7 max-w-56 text-xs"
          placeholder="Search services…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <select
          aria-label="Filter"
          className="h-7 rounded border border-input bg-transparent px-1 text-xs"
          value={filter}
          onChange={(e) => setFilter(e.target.value as Filter)}
        >
          <option value="all">All</option>
          <option value="running">Running</option>
          <option value="failed">Failed</option>
          <option value="inactive">Stopped</option>
        </select>
        <span className="ml-auto text-xs text-muted-foreground">{shown.length} services</span>
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        {error && (
          <p role="alert" className="p-3 text-red-600 dark:text-red-400">
            {error}
          </p>
        )}
        {!loaded && !error && <p className="p-3 text-muted-foreground">Loading…</p>}
        <table className="w-full table-fixed text-xs">
          <tbody>
            {shown.map((s) => (
              <tr
                key={s.unit}
                data-testid="service-row"
                className="border-b border-border/50 hover:bg-accent"
              >
                <td className="w-5 px-2">
                  <span
                    className={`inline-block h-2 w-2 rounded-full ${dot(s)}`}
                    title={`${s.active} (${s.sub})`}
                  />
                </td>
                <td className="px-1 py-1">
                  <div className="truncate font-medium">{s.unit}</div>
                  <div className="truncate text-muted-foreground">
                    {s.sub} · {s.boot === 'enabled' ? 'starts at boot' : s.boot} · {s.description}
                  </div>
                </td>
                <td className="w-80 px-1 text-right">
                  {s.active === 'active' ? (
                    <Button variant="outline" className={b} onClick={() => act('stop', s.unit)}>
                      Stop
                    </Button>
                  ) : (
                    <Button variant="outline" className={b} onClick={() => act('start', s.unit)}>
                      Start
                    </Button>
                  )}{' '}
                  <Button variant="outline" className={b} onClick={() => act('restart', s.unit)}>
                    Restart
                  </Button>{' '}
                  {s.boot === 'enabled' ? (
                    <Button variant="outline" className={b} onClick={() => act('disable', s.unit)}>
                      Disable
                    </Button>
                  ) : (
                    <Button
                      variant="outline"
                      className={b}
                      disabled={s.boot === 'static' || s.boot === 'masked'}
                      onClick={() => act('enable', s.unit)}
                    >
                      Enable
                    </Button>
                  )}{' '}
                  <Button variant="ghost" className={b} onClick={() => setLogUnit(s.unit)}>
                    Logs
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {logUnit && (
        <LogPanel
          serverId={serverId}
          actionId="services.logs"
          params={{ unit: logUnit }}
          title={logUnit}
          tool="journalctl"
          active={active}
          onClose={() => setLogUnit(null)}
        />
      )}
      <CommandsDisclosure
        serverId={serverId}
        actions={[
          { id: 'services.list' },
          { id: 'services.logs', params: { unit: 'nginx.service' } },
        ]}
      />
    </div>
  );
}
