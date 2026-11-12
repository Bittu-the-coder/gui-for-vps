import { z } from 'zod';
import { defineAction } from './define.js';

/** One command that prints everything the System Monitor charts need (parsed by metrics/sample.ts). */
export const SAMPLE_COMMAND =
  'for f in /proc/stat /proc/meminfo /proc/loadavg /proc/uptime /proc/net/dev; do echo "==$f"; cat $f; done; ' +
  'echo "==df"; df -P -B1 -x tmpfs -x devtmpfs -x squashfs 2>/dev/null; ' +
  'echo "==os"; cat /etc/os-release 2>/dev/null; echo "==kernel"; uname -sr; echo "==nproc"; nproc';

export const PROCESS_COMMAND =
  'ps -eo pid=,user=,pcpu=,pmem=,rss=,etime=,comm=,args= --sort=-pcpu | head -n 400';

export const monitorSample = defineAction({
  id: 'monitor.sample',
  title: 'Read system statistics',
  explain:
    "Reads the kernel's live counters from /proc (CPU time, memory, load, network bytes) and asks df for disk usage. Nothing is changed.",
  params: z.object({}),
  commands: () => [SAMPLE_COMMAND],
  risk: 'safe',
  recordable: false,
  quiet: true,
  internal: true,
});

export const monitorProcesses = defineAction({
  id: 'monitor.processes',
  title: 'List processes',
  explain:
    'ps lists every running program with its owner, CPU and memory use, sorted by CPU. head keeps the busiest 400.',
  params: z.object({}),
  commands: () => [PROCESS_COMMAND],
  risk: 'safe',
  recordable: false,
  quiet: true,
  internal: true,
});

const PROTECTED_NAMES = new Set(['sshd', 'systemd', 'init', 'dbus-daemon', 'systemd-logind']);
const killParams = z.object({
  pid: z.number().int().min(1).max(4_194_304),
  /** The process name, only used to warn about processes the server needs. */
  name: z.string().max(64).optional(),
});

const protectedKill = ({ pid, name }: z.infer<typeof killParams>) =>
  pid === 1 || (name && PROTECTED_NAMES.has(name))
    ? {
        risk: 'danger' as const,
        reason: `${name ?? 'Process 1'} keeps the server reachable or running. Killing it can lock you out or crash the machine.`,
      }
    : undefined;

export const processKill = defineAction({
  id: 'process.kill',
  title: 'Stop a process',
  explain:
    'Sends the TERM signal, which politely asks the program to shut down. Well-behaved programs save their work and exit. If it ignores you, a force kill is the next step.',
  params: killParams,
  commands: ({ pid }, ctx) => [`${ctx.sudo}kill -TERM ${pid}`],
  risk: 'caution',
  riskReason: 'The program will stop, and unsaved work in it is lost.',
  dynamicRisk: protectedKill,
  recordable: false,
  internal: true,
});

export const processForceKill = defineAction({
  id: 'process.force-kill',
  title: 'Force-kill a process',
  explain:
    'Sends the KILL signal, which the program cannot ignore or clean up after. The operating system removes it immediately. Use it only when a normal stop did not work.',
  params: killParams,
  commands: ({ pid }, ctx) => [`${ctx.sudo}kill -KILL ${pid}`],
  risk: 'danger',
  riskReason: 'The program gets no chance to save data or release locks, which can corrupt files.',
  dynamicRisk: protectedKill,
  recordable: false,
  internal: true,
});

export const monitorActions = [monitorSample, monitorProcesses, processKill, processForceKill];
