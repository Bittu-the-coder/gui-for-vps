import { describe, expect, it } from 'vitest';
import { cpuPercent, netRate, parseSample } from './sample.js';
import { parseContainers, parseImages, parseProcesses, parseServices } from './lists.js';

const SAMPLE = (cpuLine: string, rx = 1000, tx = 500) => `==/proc/stat
${cpuLine}
cpu0 1 2 3 4 5 6 7 8
==/proc/meminfo
MemTotal:        2048000 kB
MemFree:          100000 kB
MemAvailable:     512000 kB
SwapTotal:       1024000 kB
SwapFree:        1000000 kB
==/proc/loadavg
0.52 0.58 1.5 1/467 12345
==/proc/uptime
351735.47 234388.90
==/proc/net/dev
Inter-|   Receive                                                |  Transmit
 face |bytes    packets errs drop fifo frame compressed multicast|bytes    packets errs drop fifo colls carrier compressed
    lo: 99999     10    0    0    0     0          0         0    99999     10    0    0    0     0       0          0
  eth0: ${rx}     10    0    0    0     0          0         0    ${tx}     10    0    0    0     0       0          0
==df
Filesystem     1-blocks       Used  Available Capacity Mounted on
/dev/sda1   10000000000 4000000000 6000000000      40% /
/dev/sda1   10000000000 4000000000 6000000000      40% /etc/hosts
/dev/sdb1    2000000000  500000000 1500000000      25% /mnt/my data
==os
NAME="Ubuntu"
PRETTY_NAME="Ubuntu 24.04.1 LTS"
==kernel
Linux 6.8.0-45-generic
==nproc
4
`;

describe('parseSample', () => {
  const s = parseSample(SAMPLE('cpu  100 0 100 700 100 0 0 0 0 0'));
  it('reads cpu, memory, load, uptime, os and cores', () => {
    expect(s.cpu).toEqual({ total: 1000, idle: 800 });
    expect(s.cpus).toBe(4);
    expect(s.mem).toEqual({
      total: 2048000 * 1024,
      available: 512000 * 1024,
      swapTotal: 1024000 * 1024,
      swapFree: 1000000 * 1024,
    });
    expect(s.load).toEqual([0.52, 0.58, 1.5]);
    expect(s.uptimeSec).toBeCloseTo(351735.47);
    expect(s.os).toBe('Ubuntu 24.04.1 LTS');
    expect(s.kernel).toBe('Linux 6.8.0-45-generic');
  });
  it('skips loopback in network totals', () => expect(s.net).toEqual({ rx: 1000, tx: 500 }));
  it('dedupes bind-mounted disks and keeps mount points with spaces', () => {
    expect(s.disks.map((d) => d.mount)).toEqual(['/', '/mnt/my data']);
    expect(s.disks[0]).toMatchObject({ total: 10_000_000_000, used: 4_000_000_000 });
  });
  it('survives garbage', () => {
    const g = parseSample('nothing useful');
    expect(g.mem.total).toBe(0);
    expect(g.cpus).toBe(1);
    expect(g.disks).toEqual([]);
  });
});

describe('rates', () => {
  const a = parseSample(SAMPLE('cpu  100 0 100 700 100 0 0 0 0 0', 1000, 500));
  const b = parseSample(SAMPLE('cpu  200 0 200 800 100 0 0 0 0 0', 3000, 1500));
  it('computes cpu percent from two samples', () => {
    // delta total 300, delta idle 100 -> 66.7% busy
    expect(cpuPercent(a, b)).toBeCloseTo(66.67, 1);
    expect(cpuPercent(a, a)).toBe(0);
  });
  it('computes network bytes per second and never goes negative', () => {
    expect(netRate(a, b, 2)).toEqual({ rx: 1000, tx: 500 });
    expect(netRate(b, a, 2)).toEqual({ rx: 0, tx: 0 });
  });
});

describe('parseProcesses', () => {
  const text = `    1 root      0.0  0.1 12000 5-04:03:02 systemd /sbin/init splash
 4321 gfv      12.5  3.2 99000    01:02 node node server.js --port 3000
 bad line
`;
  it('parses rows and keeps the full command line', () => {
    const p = parseProcesses(text);
    expect(p).toHaveLength(2);
    expect(p[0]).toMatchObject({
      pid: 1,
      user: 'root',
      name: 'systemd',
      elapsed: '5-04:03:02',
      command: '/sbin/init splash',
    });
    expect(p[1]).toMatchObject({
      pid: 4321,
      cpu: 12.5,
      mem: 3.2,
      rssKb: 99000,
      command: 'node server.js --port 3000',
    });
  });
});

describe('parseServices', () => {
  const text = `==units
ssh.service            loaded active running OpenBSD Secure Shell server
nginx.service          loaded failed failed  A high performance web server
foo@.service           loaded inactive dead  template
==files
ssh.service            enabled enabled
nginx.service          disabled enabled
cron.service           static  -
`;
  it('merges runtime state with the boot setting and drops templates', () => {
    expect(parseServices(text)).toEqual([
      {
        unit: 'nginx.service',
        load: 'loaded',
        active: 'failed',
        sub: 'failed',
        description: 'A high performance web server',
        boot: 'disabled',
      },
      {
        unit: 'ssh.service',
        load: 'loaded',
        active: 'active',
        sub: 'running',
        description: 'OpenBSD Secure Shell server',
        boot: 'enabled',
      },
    ]);
  });
});

describe('docker parsers', () => {
  it('parses container and image JSON lines, ignoring noise', () => {
    const ps = `WARNING: something\n{"ID":"abc","Names":"web","Image":"nginx:1","State":"running","Status":"Up 2 hours","Ports":"0.0.0.0:80->80/tcp"}\n`;
    expect(parseContainers(ps)).toEqual([
      {
        id: 'abc',
        name: 'web',
        image: 'nginx:1',
        state: 'running',
        status: 'Up 2 hours',
        ports: '0.0.0.0:80->80/tcp',
      },
    ]);
    const im = `{"ID":"i1","Repository":"nginx","Tag":"1","Size":"187MB","CreatedSince":"2 weeks ago"}`;
    expect(parseImages(im)).toEqual([
      { id: 'i1', repository: 'nginx', tag: '1', size: '187MB', created: '2 weeks ago' },
    ]);
  });
});
