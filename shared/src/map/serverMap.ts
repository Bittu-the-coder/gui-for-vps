import type { ListeningPort, NginxSite } from '../nginx/site.js';
import { PROJECTS_DIR, type ProjectInfo } from '../projects/project.js';

/**
 * The Server Map: how traffic gets from a domain to the code that serves it.
 *
 *   domain -> nginx site -> port -> program -> project
 *
 * Built from facts GFV already reads (listening ports, nginx sites, projects) and, for linking a running program to
 * the project it came from, the working directory of each listening process. Pure functions: easy to test, and the
 * drawing is just SVG over the result.
 */

export type NodeKind = 'domain' | 'site' | 'port' | 'process' | 'project' | 'folder';
export type MapHealth = 'ok' | 'warn' | 'error' | 'info';

export interface MapNode {
  id: string;
  kind: NodeKind;
  label: string;
  sub?: string;
  health: MapHealth;
  /** Why it is warn/error/info (shown in the problems list and as a tooltip). */
  note?: string;
}
export interface MapEdge {
  from: string;
  to: string;
  /** A broken link (nothing is listening there). */
  broken?: boolean;
}
export interface MapIssue {
  nodeId: string;
  health: 'warn' | 'error';
  message: string;
}
export interface ServerMap {
  nodes: MapNode[];
  edges: MapEdge[];
  issues: MapIssue[];
  /** Listening ports that are not part of any chain above (ssh, databases...), for the "other ports" strip. */
  otherPorts: ListeningPort[];
}

export interface MapInput {
  ports: ListeningPort[];
  sites: NginxSite[];
  projects: ProjectInfo[];
  /** pid -> the process's working directory (where known). */
  cwds: Record<number, string>;
  /** The SSH user's home, to recognise ~/gfv-projects/<name> in a working directory. */
  home?: string;
}

/** Parse the `map.cwds` output: lines `PID:<pid>:<cwd>`. */
export function parseCwds(text: string): Record<number, string> {
  const out: Record<number, string> = {};
  for (const line of text.split('\n')) {
    const m = /^PID:(\d+):(.*)$/.exec(line.trim());
    if (m && m[2]) out[Number(m[1])] = m[2];
  }
  return out;
}

/** The local port a proxy target points at: http://127.0.0.1:3000, http://localhost:3000/, http://[::1]:3000. */
export function proxyPort(target: string | undefined): number | null {
  const m = /^https?:\/\/(?:127\.0\.0\.1|localhost|\[::1\]|0\.0\.0\.0):(\d{1,5})(?:\/|$)/.exec(
    target?.trim() ?? '',
  );
  const port = m ? Number(m[1]) : NaN;
  return Number.isInteger(port) && port > 0 && port < 65536 ? port : null;
}

const isLocalProxy = (t: string | undefined) => /^https?:\/\//.test(t ?? '');

export function buildServerMap(input: MapInput): ServerMap {
  const nodes = new Map<string, MapNode>();
  const edges: MapEdge[] = [];
  const issues: MapIssue[] = [];
  const add = (n: MapNode) => (nodes.has(n.id) ? nodes.get(n.id)! : (nodes.set(n.id, n), n));
  const edge = (from: string, to: string, broken = false) => {
    if (!edges.some((e) => e.from === from && e.to === to))
      edges.push({ from, to, ...(broken ? { broken } : {}) });
  };
  const flag = (n: MapNode, health: 'warn' | 'error' | 'info', note: string) => {
    // The worst state wins; the note of the worst one is kept.
    const rank = { ok: 0, info: 1, warn: 2, error: 3 } as const;
    if (rank[health] > rank[n.health]) {
      n.health = health;
      n.note = note;
    } else if (health === 'info' && n.health === 'info' && n.note && !n.note.includes(note)) {
      n.note = `${n.note} ${note}`; // informational notes add up
    }
    if (health !== 'info') issues.push({ nodeId: n.id, health, message: note });
  };

  const listening = new Map<number, ListeningPort[]>();
  for (const p of input.ports) listening.set(p.port, [...(listening.get(p.port) ?? []), p]);
  const owner = (port: number) =>
    (listening.get(port) ?? []).find((p) => p.process) ?? listening.get(port)?.[0];

  const used = new Set<number>(); // ports that appear in a chain

  const portNode = (port: number): MapNode => {
    const ps = listening.get(port);
    const any = ps?.some((p) => ['0.0.0.0', '::', '*'].includes(p.address));
    return add({
      id: `port:${port}`,
      kind: 'port',
      label: `:${port}`,
      sub: !ps ? 'nothing listening' : any ? 'any address' : 'this server only',
      health: 'ok',
    });
  };

  const attachProcess = (port: number) => {
    const o = owner(port);
    if (!o?.process) return null;
    const pn = add({
      id: `process:${o.pid ?? o.process}`,
      kind: 'process',
      label: o.process,
      sub: o.pid ? `pid ${o.pid}` : undefined,
      health: 'ok',
    });
    edge(`port:${port}`, pn.id);
    // Which project does this program belong to? Its working directory is inside ~/gfv-projects/<name>.
    const cwd = o.pid !== undefined ? input.cwds[o.pid] : undefined;
    if (cwd) {
      for (const pr of input.projects) {
        const roots = [
          `${input.home ?? ''}/${PROJECTS_DIR}/${pr.name}`,
          `/${PROJECTS_DIR}/${pr.name}`,
        ];
        if (
          roots.some((r) => cwd === r || cwd.startsWith(`${r}/`)) ||
          cwd.includes(`/${PROJECTS_DIR}/${pr.name}`)
        ) {
          edge(pn.id, `project:${pr.name}`);
          break;
        }
      }
    }
    return pn;
  };

  // Projects first, so processes can link to them.
  for (const pr of input.projects) {
    const n = add({
      id: `project:${pr.name}`,
      kind: 'project',
      label: pr.name,
      sub: `${pr.branch}${pr.head ? ` @ ${pr.head}` : ''}`,
      health: 'ok',
    });
    if (pr.hasUnit && pr.active === 'failed')
      flag(n, 'error', `The service for ${pr.name} has failed.`);
    else if (pr.hasUnit && pr.active === 'inactive')
      flag(n, 'warn', `The service for ${pr.name} is not running.`);
    else if (!pr.hasUnit) flag(n, 'info', `${pr.name} is not set up as a service.`);
    if (pr.behind)
      flag(
        n,
        'info',
        `${pr.name} is ${pr.behind} commit${pr.behind === 1 ? '' : 's'} behind its repository.`,
      );
  }

  // Sites and what they serve.
  for (const s of input.sites) {
    const siteId = `site:${s.name}`;
    const site = add({
      id: siteId,
      kind: 'site',
      label: s.name,
      sub: s.target ?? 'no target',
      health: 'ok',
    });
    if (!s.enabled) flag(site, 'warn', `The site ${s.name} is disabled.`);

    const names = s.serverNames.filter((n) => n !== '_' && n !== '');
    for (const d of names.length ? names : []) {
      const dn = add({
        id: `domain:${d}`,
        kind: 'domain',
        label: d,
        sub: s.https ? 'HTTPS' : 'HTTP only',
        health: 'ok',
      });
      edge(dn.id, siteId);
      if (!s.https && /\./.test(d)) flag(dn, 'info', `${d} is served without HTTPS.`);
    }

    const port = proxyPort(s.target);
    if (port !== null) {
      used.add(port);
      const pn = portNode(port);
      const alive = listening.has(port);
      edge(siteId, pn.id, !alive);
      if (!alive) {
        flag(
          pn,
          'error',
          `${s.name} sends visitors to port ${port}, but nothing is listening there.`,
        );
        flag(site, 'error', `Nothing is listening on port ${port}, so visitors get a 502 error.`);
      } else attachProcess(port);
    } else if (isLocalProxy(s.target)) {
      // A proxy to another machine (or a named upstream): shown as a plain target.
      const t = add({
        id: `folder:${s.target}`,
        kind: 'folder',
        label: s.target!,
        sub: 'other machine',
        health: 'info',
      });
      edge(siteId, t.id);
    } else if (s.target) {
      const f = add({
        id: `folder:${s.target}`,
        kind: 'folder',
        label: s.target,
        sub: 'static files',
        health: 'ok',
      });
      edge(siteId, f.id);
    }
  }

  // A project's own listening program, when no site points at it yet: still part of the story.
  for (const p of input.ports) {
    if (used.has(p.port) || !p.pid) continue;
    const cwd = input.cwds[p.pid];
    if (cwd && input.projects.some((pr) => cwd.includes(`/${PROJECTS_DIR}/${pr.name}`))) {
      used.add(p.port);
      portNode(p.port);
      attachProcess(p.port);
    }
  }

  const otherPorts = input.ports.filter((p) => !used.has(p.port));
  return { nodes: [...nodes.values()], edges, issues, otherPorts };
}

// --- Layout ---------------------------------------------------------------------------------------------

export const COLUMNS: NodeKind[] = ['domain', 'site', 'port', 'process', 'project'];
export interface Placed extends MapNode {
  x: number;
  y: number;
  w: number;
  h: number;
}

export const NODE_W = 168;
export const NODE_H = 44;
export const COL_GAP = 56;
export const ROW_GAP = 14;

/**
 * Columns by kind (folders sit with the ports), rows ordered so connected nodes sit near each other: nodes are
 * placed in the order of the first chain that reaches them, which keeps most edges short and uncrossed.
 */
export function layoutMap(map: ServerMap): { nodes: Placed[]; width: number; height: number } {
  const col = (k: NodeKind) => (k === 'folder' ? 2 : COLUMNS.indexOf(k));
  const order = new Map<string, number>();
  const outs = new Map<string, string[]>();
  for (const e of map.edges) outs.set(e.from, [...(outs.get(e.from) ?? []), e.to]);
  const hasIn = new Set(map.edges.map((e) => e.to));
  const roots = map.nodes
    .filter((n) => !hasIn.has(n.id))
    .sort((a, b) => col(a.kind) - col(b.kind) || a.label.localeCompare(b.label));
  let i = 0;
  const visit = (id: string) => {
    if (order.has(id)) return;
    order.set(id, i++);
    for (const t of outs.get(id) ?? []) visit(t);
  };
  roots.forEach((r) => visit(r.id));
  map.nodes.forEach((n) => visit(n.id)); // anything left (cycles)

  const perCol: number[] = [];
  const placed = [...map.nodes]
    .sort((a, b) => order.get(a.id)! - order.get(b.id)!)
    .map((n) => {
      const c = col(n.kind);
      const row = perCol[c] ?? 0;
      perCol[c] = row + 1;
      return { ...n, x: c * (NODE_W + COL_GAP), y: row * (NODE_H + ROW_GAP), w: NODE_W, h: NODE_H };
    });
  const rows = Math.max(0, ...perCol.map((n) => n ?? 0));
  return {
    nodes: placed,
    width: COLUMNS.length * NODE_W + (COLUMNS.length - 1) * COL_GAP,
    height: Math.max(0, rows * (NODE_H + ROW_GAP) - ROW_GAP),
  };
}
