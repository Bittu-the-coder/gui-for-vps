import {
  buildServerMap,
  layoutMap,
  parseCwds,
  parsePorts,
  parseProjects,
  parseSites,
  type MapNode,
  type NodeKind,
  type Placed,
  type ServerMap,
} from '@gfv/shared';
import { AlertTriangle, CircleAlert, Info } from 'lucide-react';
import { useMemo, useState } from 'react';
import { CommandsDisclosure } from '../../components/CommandsDisclosure';
import { NoServer } from '../../components/NoServer';
import { openApp } from '../../desktop/openApp';
import { useDesktop } from '../../desktop/windowStore';
import { usePolling } from '../../hooks/usePolling';
import { api } from '../../lib/api';
import { useServers } from '../../stores/serverStore';
import { appById } from '../registry';

const HEADERS = ['Domains', 'Nginx sites', 'Ports', 'Programs', 'Projects'];
const PAD = 12;
const TOP = 30;

/** Which app explains a node. */
const OPENS: Record<NodeKind, string> = {
  domain: 'network',
  site: 'network',
  port: 'network',
  process: 'monitor',
  project: 'projects',
  folder: 'files',
};

const FILL = {
  ok: 'fill-background stroke-border',
  info: 'fill-primary/10 stroke-primary/40',
  warn: 'fill-warning/10 stroke-warning',
  error: 'fill-danger/10 stroke-danger',
} as const;

function edgePath(a: Placed, b: Placed): string {
  const x1 = a.x + a.w;
  const y1 = a.y + a.h / 2;
  const x2 = b.x;
  const y2 = b.y + b.h / 2;
  const mid = (x1 + x2) / 2;
  return `M ${x1} ${y1} C ${mid} ${y1}, ${mid} ${y2}, ${x2} ${y2}`;
}

/** How traffic reaches your code: domain, nginx site, port, program, project. Problems are marked in red. */
export function ServerMapApp({ windowId }: { windowId: string }) {
  const win = useDesktop((s) => s.windows[windowId]);
  const serverId = win?.serverId;
  const active = !!serverId && !win?.minimized;
  const [map, setMap] = useState<ServerMap | null>(null);
  const [error, setError] = useState('');
  const [noSs, setNoSs] = useState(false);
  const [focus, setFocus] = useState<string | null>(null);

  const load = async () => {
    const q = (id: string) => api.query(serverId!, id);
    const [ports, sites, projects, cwds] = await Promise.all([
      q('ports.list'),
      q('nginx.sites.list'),
      q('projects.list'),
      q('map.cwds'),
    ]);
    const bad = [ports, projects].find((r) => r.exitCode !== 0 && !r.stdout.includes('NO_SS'));
    setError(bad ? (bad.stderr.trim() || 'A command failed on the server.').slice(0, 300) : '');
    setNoSs(ports.stdout.includes('NO_SS'));
    setMap(
      buildServerMap({
        ports: parsePorts(ports.stdout),
        sites: parseSites(sites.stdout),
        projects: parseProjects(projects.stdout),
        cwds: parseCwds(cwds.stdout),
      }),
    );
  };
  usePolling(load, 5000, active);

  const layout = useMemo(() => (map ? layoutMap(map) : null), [map]);
  if (!serverId) return <NoServer app="Server Map" />;

  const open = (n: MapNode) => {
    useServers.getState().setActive(serverId); // new windows are tied to the active server
    openApp(appById(OPENS[n.kind])!);
  };
  const byId = new Map(layout?.nodes.map((n) => [n.id, n]));
  const empty = map && map.nodes.length === 0;
  const problems = map?.issues ?? [];

  return (
    <div className="flex h-full flex-col text-body">
      {error && (
        <p role="alert" className="p-3 text-danger">
          {error}
        </p>
      )}
      <div className="flex min-h-0 flex-1">
        <div className="min-w-0 flex-1 overflow-auto p-3">
          {!map && !error && <p className="text-muted-foreground">Reading the server…</p>}
          {noSs && (
            <p className="mb-2 rounded-lg border border-warning bg-warning/10 p-2 text-footnote">
              The <code>ss</code> tool is missing on this server, so ports and programs cannot be
              shown (install <code>iproute2</code>).
            </p>
          )}
          {empty && (
            <p className="p-8 text-center text-muted-foreground">
              Nothing to map yet. Add a site in the <b>Network</b> app, or deploy an app in{' '}
              <b>Projects</b>, and its path from domain to code appears here.
            </p>
          )}
          {layout && map && !empty && (
            <svg
              role="group"
              aria-label="Server map"
              width={layout.width + PAD * 2}
              height={layout.height + TOP + PAD * 2}
              className="max-w-none"
            >
              <g transform={`translate(${PAD} ${PAD})`}>
                {HEADERS.map((h, i) => (
                  <text
                    key={h}
                    x={i * 224}
                    y={12}
                    className="fill-faint-foreground text-[11px] font-semibold uppercase tracking-wide"
                  >
                    {h}
                  </text>
                ))}
                <g transform={`translate(0 ${TOP})`}>
                  {map.edges.map((e) => {
                    const a = byId.get(e.from);
                    const b = byId.get(e.to);
                    if (!a || !b) return null;
                    const lit = focus === e.from || focus === e.to;
                    return (
                      <path
                        key={`${e.from}>${e.to}`}
                        d={edgePath(a, b)}
                        fill="none"
                        strokeWidth={lit ? 2.5 : 1.5}
                        strokeDasharray={e.broken ? '5 4' : undefined}
                        className={
                          e.broken
                            ? 'stroke-danger'
                            : lit
                              ? 'stroke-primary'
                              : 'stroke-faint-foreground/60'
                        }
                      />
                    );
                  })}
                  {layout.nodes.map((n) => (
                    <g
                      key={n.id}
                      data-testid="map-node"
                      data-kind={n.kind}
                      data-health={n.health}
                      data-label={n.label}
                      role="button"
                      tabIndex={0}
                      aria-label={`${n.kind} ${n.label}${n.sub ? `, ${n.sub}` : ''}${n.health === 'ok' ? '' : `, ${n.health}: ${n.note ?? ''}`}. Press Enter to open.`}
                      transform={`translate(${n.x} ${n.y})`}
                      className="cursor-pointer outline-none [&:focus-visible>rect]:stroke-[var(--ring)] [&:focus-visible>rect]:stroke-[3]"
                      onClick={() => open(n)}
                      onKeyDown={(ev) =>
                        (ev.key === 'Enter' || ev.key === ' ') && (ev.preventDefault(), open(n))
                      }
                      onPointerEnter={() => setFocus(n.id)}
                      onPointerLeave={() => setFocus(null)}
                      onFocus={() => setFocus(n.id)}
                      onBlur={() => setFocus(null)}
                    >
                      <title>{n.note ?? `${n.label}${n.sub ? `: ${n.sub}` : ''}`}</title>
                      <rect
                        width={n.w}
                        height={n.h}
                        rx={10}
                        strokeWidth={1.5}
                        className={FILL[n.health]}
                      />
                      <text x={10} y={19} className="fill-foreground text-[12px] font-medium">
                        {n.label.length > 22 ? `${n.label.slice(0, 21)}…` : n.label}
                      </text>
                      {n.sub && (
                        <text x={10} y={34} className="fill-muted-foreground text-[10.5px]">
                          {n.sub.length > 26 ? `${n.sub.slice(0, 25)}…` : n.sub}
                        </text>
                      )}
                    </g>
                  ))}
                </g>
              </g>
            </svg>
          )}
          {map && map.otherPorts.length > 0 && (
            <div className="mt-3" aria-label="Other listening ports">
              <p className="mb-1 text-caption font-semibold uppercase tracking-wide text-faint-foreground">
                Other listening ports
              </p>
              <ul className="flex flex-wrap gap-1.5">
                {map.otherPorts.map((p) => (
                  <li
                    key={`${p.proto}${p.address}${p.port}`}
                    className="rounded-full border border-separator px-2 py-0.5 text-footnote"
                  >
                    :{p.port} <span className="text-muted-foreground">{p.process ?? p.proto}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
        <aside
          aria-label="Problems"
          className="w-64 shrink-0 overflow-auto border-l border-border bg-sunken p-3"
        >
          <h2 className="mb-2 flex items-center gap-1.5 text-footnote font-semibold uppercase tracking-wide text-muted-foreground">
            {problems.length ? (
              <AlertTriangle size={14} className="text-warning" />
            ) : (
              <Info size={14} />
            )}{' '}
            Problems
          </h2>
          {map && problems.length === 0 && (
            <p data-testid="no-problems" className="text-footnote text-muted-foreground">
              {map.nodes.length ? 'Everything on this map looks healthy.' : 'No problems found.'}
            </p>
          )}
          <ul className="flex flex-col gap-2">
            {problems.map((p, i) => (
              <li key={i} data-testid="map-problem" data-health={p.health}>
                <button
                  className="flex w-full items-start gap-1.5 rounded-lg p-1.5 text-left text-footnote hover:bg-accent"
                  onClick={() => setFocus(p.nodeId)}
                >
                  <CircleAlert
                    size={14}
                    className={`mt-0.5 shrink-0 ${p.health === 'error' ? 'text-danger' : 'text-warning'}`}
                  />
                  <span>{p.message}</span>
                </button>
              </li>
            ))}
          </ul>
          <p className="mt-4 text-caption text-faint-foreground">
            Updates every 5 seconds. Click a box to open the app that manages it. Dashed red lines
            are links that do not work.
          </p>
        </aside>
      </div>
      <CommandsDisclosure
        serverId={serverId}
        actions={[
          { id: 'ports.list' },
          { id: 'nginx.sites.list' },
          { id: 'projects.list' },
          { id: 'map.cwds' },
        ]}
      />
    </div>
  );
}
