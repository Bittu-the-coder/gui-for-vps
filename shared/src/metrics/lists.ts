/** Parsers for process, systemd service and Docker listings. Pure, tested on fixtures. */

export interface ProcessInfo {
  pid: number;
  user: string;
  cpu: number;
  mem: number;
  rssKb: number;
  elapsed: string;
  name: string;
  command: string;
}

/** Output of PROCESS_COMMAND: pid user %cpu %mem rss etime comm args... (no header). */
export function parseProcesses(text: string): ProcessInfo[] {
  const out: ProcessInfo[] = [];
  for (const line of text.split('\n')) {
    const m = /^\s*(\d+)\s+(\S+)\s+([\d.]+)\s+([\d.]+)\s+(\d+)\s+(\S+)\s+(\S+)\s*(.*)$/.exec(line);
    if (!m) continue;
    out.push({
      pid: Number(m[1]),
      user: m[2]!,
      cpu: Number(m[3]),
      mem: Number(m[4]),
      rssKb: Number(m[5]),
      elapsed: m[6]!,
      name: m[7]!,
      command: m[8] || m[7]!,
    });
  }
  return out;
}

export interface ServiceInfo {
  unit: string;
  /** loaded / not-found / masked */
  load: string;
  /** active / inactive / failed / activating */
  active: string;
  /** running / exited / dead / failed */
  sub: string;
  description: string;
  /** enabled / disabled / static / masked ... ("unknown" if not listed) */
  boot: string;
}

/** Output of LIST_SERVICES_COMMAND: "==units" and "==files" sections. */
export function parseServices(text: string): ServiceInfo[] {
  const boot = new Map<string, string>();
  const units: ServiceInfo[] = [];
  let section = '';
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (line.startsWith('==')) {
      section = line.slice(2);
      continue;
    }
    if (!line) continue;
    if (section === 'files') {
      const [unit, state] = line.split(/\s+/);
      if (unit && state) boot.set(unit, state);
    } else if (section === 'units') {
      const m = /^(\S+\.service)\s+(\S+)\s+(\S+)\s+(\S+)\s*(.*)$/.exec(
        line.replace(/^[●*]\s*/, ''),
      );
      if (m && !m[1]!.includes('@.')) {
        units.push({
          unit: m[1]!,
          load: m[2]!,
          active: m[3]!,
          sub: m[4]!,
          description: m[5] ?? '',
          boot: 'unknown',
        });
      }
    }
  }
  return units
    .map((u) => ({ ...u, boot: boot.get(u.unit) ?? u.boot }))
    .sort((a, b) => a.unit.localeCompare(b.unit));
}

export interface ContainerInfo {
  id: string;
  name: string;
  image: string;
  /** running / exited / paused / created ... */
  state: string;
  status: string;
  ports: string;
}

export interface ImageInfo {
  id: string;
  repository: string;
  tag: string;
  size: string;
  created: string;
}

function jsonLines(text: string): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  for (const line of text.split('\n')) {
    if (!line.trim().startsWith('{')) continue;
    try {
      const v: unknown = JSON.parse(line);
      if (v && typeof v === 'object') out.push(v as Record<string, unknown>);
    } catch {
      /* skip noise lines */
    }
  }
  return out;
}

const str = (v: unknown) => (typeof v === 'string' ? v : '');

export function parseContainers(text: string): ContainerInfo[] {
  return jsonLines(text).map((o) => ({
    id: str(o.ID),
    name: str(o.Names),
    image: str(o.Image),
    state: str(o.State),
    status: str(o.Status),
    ports: str(o.Ports),
  }));
}

export function parseImages(text: string): ImageInfo[] {
  return jsonLines(text).map((o) => ({
    id: str(o.ID),
    repository: str(o.Repository),
    tag: str(o.Tag),
    size: str(o.Size),
    created: str(o.CreatedSince),
  }));
}
