/** Parses the output of SAMPLE_COMMAND (see actions/monitor.ts). Pure, so it is unit-tested on fixtures. */

export interface DiskUsage {
  fs: string;
  mount: string;
  total: number;
  used: number;
}

export interface Sample {
  /** Cumulative CPU jiffies (all cores). Percent usage needs two samples: see cpuPercent. */
  cpu: { total: number; idle: number };
  cpus: number;
  mem: { total: number; available: number; swapTotal: number; swapFree: number };
  load: [number, number, number];
  uptimeSec: number;
  /** Cumulative bytes over all interfaces except loopback. */
  net: { rx: number; tx: number };
  disks: DiskUsage[];
  os: string;
  kernel: string;
}

function sections(text: string): Map<string, string> {
  const out = new Map<string, string>();
  let name: string | null = null;
  let buf: string[] = [];
  const flush = () => name && out.set(name, buf.join('\n'));
  for (const line of text.split('\n')) {
    if (line.startsWith('==')) {
      flush();
      name = line.slice(2).trim();
      buf = [];
    } else buf.push(line);
  }
  flush();
  return out;
}

const num = (v: string | undefined) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

export function parseSample(text: string): Sample {
  const sec = sections(text);

  const cpuLine = (sec.get('/proc/stat') ?? '').split('\n').find((l) => /^cpu\s/.test(l)) ?? '';
  const j = cpuLine.trim().split(/\s+/).slice(1).map(Number);
  // user nice system idle iowait irq softirq steal
  const total = j.slice(0, 8).reduce((a, b) => a + (b || 0), 0);
  const idle = (j[3] ?? 0) + (j[4] ?? 0);

  const mi = new Map<string, number>();
  for (const l of (sec.get('/proc/meminfo') ?? '').split('\n')) {
    const m = /^(\w+):\s+(\d+)/.exec(l);
    if (m) mi.set(m[1]!, Number(m[2]) * 1024);
  }
  const memTotal = mi.get('MemTotal') ?? 0;

  const la = (sec.get('/proc/loadavg') ?? '').trim().split(/\s+/);

  let rx = 0;
  let tx = 0;
  for (const l of (sec.get('/proc/net/dev') ?? '').split('\n')) {
    const m = /^\s*([^:\s]+):\s*(.*)$/.exec(l);
    if (!m || m[1] === 'lo') continue;
    const f = m[2]!.trim().split(/\s+/);
    rx += num(f[0]);
    tx += num(f[8]);
  }

  // df -P: "Filesystem 1-blocks Used Available Capacity Mounted on" (mount point may contain spaces)
  const byDevice = new Map<string, DiskUsage>();
  for (const l of (sec.get('df') ?? '').split('\n').slice(1)) {
    const m = /^(\S+)\s+(\d+)\s+(\d+)\s+\d+\s+\d+%\s+(.+)$/.exec(l.trim());
    if (!m) continue;
    const d: DiskUsage = { fs: m[1]!, total: Number(m[2]), used: Number(m[3]), mount: m[4]! };
    if (d.total === 0) continue;
    // The same device mounted several times (bind mounts): keep the shortest mount point.
    const key = `${d.fs}:${d.total}`;
    const prev = byDevice.get(key);
    if (!prev || d.mount.length < prev.mount.length) byDevice.set(key, d);
  }

  const osRelease = sec.get('os') ?? '';
  const pretty = /^PRETTY_NAME=(.*)$/m.exec(osRelease)?.[1]?.replace(/^"|"$/g, '');

  return {
    cpu: { total, idle },
    cpus: Math.max(1, num((sec.get('nproc') ?? '').trim())),
    mem: {
      total: memTotal,
      available: mi.get('MemAvailable') ?? mi.get('MemFree') ?? 0,
      swapTotal: mi.get('SwapTotal') ?? 0,
      swapFree: mi.get('SwapFree') ?? 0,
    },
    load: [num(la[0]), num(la[1]), num(la[2])],
    uptimeSec: num((sec.get('/proc/uptime') ?? '').trim().split(/\s+/)[0]),
    net: { rx, tx },
    disks: [...byDevice.values()],
    os: pretty ?? 'Linux',
    kernel: (sec.get('kernel') ?? '').trim(),
  };
}

/** CPU busy % between two samples (0 to 100). */
export function cpuPercent(prev: Sample, cur: Sample): number {
  const dt = cur.cpu.total - prev.cpu.total;
  const di = cur.cpu.idle - prev.cpu.idle;
  if (dt <= 0) return 0;
  return Math.min(100, Math.max(0, (1 - di / dt) * 100));
}

/** Network bytes per second between two samples taken `seconds` apart. */
export function netRate(prev: Sample, cur: Sample, seconds: number): { rx: number; tx: number } {
  if (seconds <= 0) return { rx: 0, tx: 0 };
  // Counters can reset (interface restart): never report negative rates.
  return {
    rx: Math.max(0, (cur.net.rx - prev.net.rx) / seconds),
    tx: Math.max(0, (cur.net.tx - prev.net.tx) / seconds),
  };
}
