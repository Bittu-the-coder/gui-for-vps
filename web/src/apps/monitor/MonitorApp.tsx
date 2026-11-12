import {
  cpuPercent,
  netRate,
  parseProcesses,
  parseSample,
  type ProcessInfo,
  type Sample,
} from '@gfv/shared';
import { useMemo, useRef, useState } from 'react';
import type uPlot from 'uplot';
import { CommandsDisclosure } from '../../components/CommandsDisclosure';
import { NoServer, queryProblem } from '../../components/NoServer';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { useDesktop } from '../../desktop/windowStore';
import { usePolling } from '../../hooks/usePolling';
import { api } from '../../lib/api';
import { requestRun } from '../../runner/runStore';
import { bytes, duration } from './format';
import { UPlotChart } from './UPlotChart';

const POINTS = 60; // 60 samples x 2 s = a 2-minute window
type SortKey = 'cpu' | 'mem' | 'pid' | 'name';

interface History {
  t: number[];
  cpu: number[];
  mem: number[];
  rx: number[];
  tx: number[];
}
const EMPTY: History = { t: [], cpu: [], mem: [], rx: [], tx: [] };
const push = (arr: number[], v: number) => [...arr, v].slice(-POINTS);

function Card({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded border border-border p-2">
      <div className="text-[10px] uppercase text-muted-foreground">{label}</div>
      <div className="text-lg font-semibold tabular-nums">{value}</div>
      {sub && <div className="truncate text-[11px] text-muted-foreground">{sub}</div>}
    </div>
  );
}

function ChartBox({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded border border-border p-2">
      <div className="mb-1 text-[10px] uppercase text-muted-foreground">{title}</div>
      <div className="h-24">{children}</div>
    </div>
  );
}

export function MonitorApp({ windowId }: { windowId: string }) {
  const win = useDesktop((s) => s.windows[windowId]);
  const dark = useDesktop((s) => s.theme) === 'dark';
  const serverId = win?.serverId;
  const active = !!serverId && !win?.minimized;

  const [sample, setSample] = useState<Sample | null>(null);
  const [hist, setHist] = useState<History>(EMPTY);
  const [procs, setProcs] = useState<ProcessInfo[]>([]);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState<SortKey>('cpu');
  const prev = useRef<{ s: Sample; at: number } | null>(null);

  usePolling(
    async () => {
      const r = await api.query(serverId!, 'monitor.sample');
      const problem = queryProblem(r.exitCode, r.stderr, 'the system sampler');
      if (problem) return setError(problem);
      setError('');
      const s = parseSample(r.stdout);
      const now = Date.now();
      const p = prev.current;
      prev.current = { s, at: now };
      setSample(s);
      if (!p) return;
      const rate = netRate(p.s, s, (now - p.at) / 1000);
      const used = s.mem.total ? ((s.mem.total - s.mem.available) / s.mem.total) * 100 : 0;
      setHist((h) => ({
        t: push(h.t, now / 1000),
        cpu: push(h.cpu, cpuPercent(p.s, s)),
        mem: push(h.mem, used),
        rx: push(h.rx, rate.rx),
        tx: push(h.tx, rate.tx),
      }));
    },
    2000,
    active,
  );

  usePolling(
    async () => {
      const r = await api.query(serverId!, 'monitor.processes');
      if (r.exitCode === 0) setProcs(parseProcesses(r.stdout));
    },
    4000,
    active,
  );

  const shown = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = q
      ? procs.filter((p) => `${p.pid} ${p.user} ${p.command}`.toLowerCase().includes(q))
      : procs;
    const by: Record<SortKey, (a: ProcessInfo, b: ProcessInfo) => number> = {
      cpu: (a, b) => b.cpu - a.cpu,
      mem: (a, b) => b.mem - a.mem,
      pid: (a, b) => a.pid - b.pid,
      name: (a, b) => a.name.localeCompare(b.name),
    };
    return [...list].sort(by[sort]).slice(0, 100);
  }, [procs, search, sort]);

  if (!serverId) return <NoServer app="Monitor" />;

  const data = (...cols: number[][]): uPlot.AlignedData => [hist.t, ...cols];
  const memUsed = sample ? sample.mem.total - sample.mem.available : 0;
  const kill = (p: ProcessInfo, force: boolean) =>
    requestRun({
      serverId,
      actionId: force ? 'process.force-kill' : 'process.kill',
      params: { pid: p.pid, name: p.name },
    });

  return (
    <div className="flex h-full flex-col text-sm">
      <div className="min-h-0 flex-1 overflow-auto p-2">
        {error && (
          <p role="alert" className="mb-2 text-red-600 dark:text-red-400">
            {error}
          </p>
        )}
        {!sample && !error && <p className="text-muted-foreground">Reading statistics…</p>}
        {sample && (
          <>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <Card
                label="CPU"
                value={`${(hist.cpu.at(-1) ?? 0).toFixed(0)}%`}
                sub={`${sample.cpus} core${sample.cpus === 1 ? '' : 's'}`}
              />
              <Card
                label="Memory"
                value={`${sample.mem.total ? Math.round((memUsed / sample.mem.total) * 100) : 0}%`}
                sub={`${bytes(memUsed)} of ${bytes(sample.mem.total)}`}
              />
              <Card
                label="Load average"
                value={sample.load[0].toFixed(2)}
                sub={`${sample.load[1]} · ${sample.load[2]}`}
              />
              <Card label="Uptime" value={duration(sample.uptimeSec)} sub={sample.os} />
            </div>

            <div className="mt-2 grid grid-cols-1 gap-2 md:grid-cols-3">
              <ChartBox title="CPU %">
                <UPlotChart
                  data={data(hist.cpu)}
                  dark={dark}
                  yMax={100}
                  format={(v) => `${v}%`}
                  series={[{ label: 'CPU', stroke: '#38bdf8' }]}
                />
              </ChartBox>
              <ChartBox title="Memory used %">
                <UPlotChart
                  data={data(hist.mem)}
                  dark={dark}
                  yMax={100}
                  format={(v) => `${v}%`}
                  series={[{ label: 'Memory', stroke: '#a78bfa' }]}
                />
              </ChartBox>
              <ChartBox title="Network (↓ blue, ↑ green) per second">
                <UPlotChart
                  data={data(hist.rx, hist.tx)}
                  dark={dark}
                  format={bytes}
                  series={[
                    { label: 'Down', stroke: '#38bdf8' },
                    { label: 'Up', stroke: '#34d399' },
                  ]}
                />
              </ChartBox>
            </div>

            <div className="mt-2 flex flex-col gap-1">
              {sample.disks.map((d) => {
                const pct = Math.round((d.used / d.total) * 100);
                return (
                  <div key={d.fs + d.mount} className="text-xs">
                    <div className="flex justify-between">
                      <span className="truncate">
                        💽 {d.mount} <span className="text-muted-foreground">({d.fs})</span>
                      </span>
                      <span className="tabular-nums">
                        {bytes(d.used)} / {bytes(d.total)} · {pct}%
                      </span>
                    </div>
                    <div className="h-1.5 overflow-hidden rounded bg-muted">
                      <div
                        className={
                          pct > 90
                            ? 'h-full bg-red-500'
                            : pct > 75
                              ? 'h-full bg-amber-500'
                              : 'h-full bg-sky-500'
                        }
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </>
        )}

        <div className="mt-3 flex items-center gap-2">
          <h3 className="text-xs font-semibold uppercase text-muted-foreground">Processes</h3>
          <Input
            aria-label="Search processes"
            className="h-7 max-w-48 text-xs"
            placeholder="Search…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <select
            aria-label="Sort by"
            className="h-7 rounded border border-input bg-transparent px-1 text-xs"
            value={sort}
            onChange={(e) => setSort(e.target.value as SortKey)}
          >
            <option value="cpu">Sort: CPU</option>
            <option value="mem">Sort: Memory</option>
            <option value="pid">Sort: PID</option>
            <option value="name">Sort: Name</option>
          </select>
        </div>
        <table className="mt-1 w-full table-fixed text-xs">
          <thead className="text-left text-muted-foreground">
            <tr>
              <th className="w-14 px-1">PID</th>
              <th className="w-20 px-1">User</th>
              <th className="w-12 px-1 text-right">CPU%</th>
              <th className="w-12 px-1 text-right">Mem%</th>
              <th className="px-1">Command</th>
              <th className="w-28 px-1" />
            </tr>
          </thead>
          <tbody>
            {shown.map((p) => (
              <tr key={p.pid} data-testid="proc-row" className="hover:bg-accent">
                <td className="px-1 tabular-nums">{p.pid}</td>
                <td className="truncate px-1">{p.user}</td>
                <td className="px-1 text-right tabular-nums">{p.cpu.toFixed(1)}</td>
                <td className="px-1 text-right tabular-nums">{p.mem.toFixed(1)}</td>
                <td className="truncate px-1 font-mono" title={p.command}>
                  {p.command}
                </td>
                <td className="px-1 text-right">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 px-1.5"
                    onClick={() => kill(p, false)}
                  >
                    Stop
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 px-1.5 text-red-500"
                    onClick={() => kill(p, true)}
                  >
                    Kill
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <CommandsDisclosure
        serverId={serverId}
        actions={[{ id: 'monitor.sample' }, { id: 'monitor.processes' }]}
      />
    </div>
  );
}
