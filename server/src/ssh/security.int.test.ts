import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { connect as tcp } from 'node:net';
import { resolve } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  evaluate,
  guardStartCommands,
  parseAudit,
  parseBackupJobs,
  parseBackups,
  previewAction,
  sshdGuard,
} from '@gfv/shared';
import { buildApp } from '../app.js';
import { exclusive, testCtx } from '../testUtil.js';

// Security checkup + scheduled backups on a REAL server (vps-systemd: real systemd, real sshd, real apt):
//   docker compose -f e2e/docker-compose.yml --profile systemd up -d --build vps-systemd
const up = await new Promise<boolean>((ok) => {
  const s = tcp(2204, '127.0.0.1');
  s.setTimeout(1500, () => (s.destroy(), ok(false)));
  s.on('connect', () => (s.end(), ok(true)));
  s.on('error', () => ok(false));
});
const privateKey = readFileSync(resolve(__dirname, '../../../e2e/keys/id_test'), 'utf8');
const H = { 'x-gfv-token': 't' };
vi.setConfig({ testTimeout: 600_000, hookTimeout: 60_000 });

const box = (cmd: string) =>
  execSync(`docker exec gfv-vps-systemd sh -c ${JSON.stringify(cmd)}`, { encoding: 'utf8' }).trim();
const sshd = (key: string) => box(`sshd -T | grep -i '^${key} '`).split(' ')[1];
const TEST_DROPIN = '/etc/ssh/sshd_config.d/10-gfv-test.conf';

describe.skipIf(!up)('security checkup and scheduled backups (real systemd)', () => {
  const ctx = testCtx();
  let release: () => void = () => {};
  // These two files share one server (its firewall and sshd): never at the same time.
  beforeAll(async () => {
    release = await exclusive('systemd');
  }, 1_200_000);
  let app: FastifyInstance;
  let id: string;
  const call = (method: 'GET' | 'POST', url: string, payload?: object) =>
    app.inject({ method, url, headers: H, payload });
  const run = async (actionId: string, params: object = {}) => {
    const r = await call('POST', '/api/runs', { serverId: id, actionId, params, confirmed: true });
    expect(r.statusCode, r.body).toBe(200);
    const rr = ctx.runner.get(r.json().runId)!;
    await rr.done;
    return { run: rr, runId: r.json().runId as string, text: rr.outputTail };
  };
  const audit = async () => {
    const q = await ctx.runner.query(id, 'security.audit', {});
    if (!q.ok) throw new Error(JSON.stringify(q));
    return parseAudit(q.stdout);
  };
  const remote = (cmd: string) =>
    new Promise<{ code: number; out: string }>((res, rej) =>
      ctx.pool.getClient(id)!.exec(cmd, (e, st) => {
        if (e) return rej(e);
        let out = '';
        st.on('data', (d: Buffer) => (out += d));
        st.stderr.on('data', (d: Buffer) => (out += d));
        st.on('close', (code: number) => res({ code, out: out.trim() }));
      }),
    );

  const cleanup = () => {
    try {
      box(
        `rm -f ${TEST_DROPIN} /etc/ssh/sshd_config.d/00-gfv-hardening.conf; rm -rf /home/gfv/.gfv/guard /home/gfv/gfv-restore; ` +
          'systemctl disable --now gfv-backup-etc-test.timer >/dev/null 2>&1; rm -f /etc/systemd/system/gfv-backup-etc-test.* /usr/local/lib/gfv/backup-etc-test.sh; rm -rf /home/gfv/.gfv/backups; systemctl daemon-reload; systemctl reload ssh; ' +
          '[ -f /home/gfv/.ssh/authorized_keys.bak ] && mv /home/gfv/.ssh/authorized_keys.bak /home/gfv/.ssh/authorized_keys; true',
      );
    } catch {
      /* container gone */
    }
  };
  afterAll(async () => {
    cleanup();
    ctx.pool.disconnectAll();
    await app?.close();
    release();
  });

  it('connects and reads the audit of a real server', async () => {
    cleanup();
    app = await buildApp('t', ctx);
    await app.ready();
    await call('POST', '/api/vault/create', { password: 'master-pass' });
    id = (
      await call('POST', '/api/servers', {
        name: 'systemd',
        host: '127.0.0.1',
        port: 2204,
        username: 'gfv',
        authType: 'key',
        privateKey,
      })
    ).json().id;
    const first = (await call('POST', `/api/servers/${id}/connect`)).json();
    await call('POST', `/api/servers/${id}/trust-host-key`, { fingerprint: first.fingerprint });
    expect((await call('POST', `/api/servers/${id}/connect`)).json().status).toBe('connected');
    box('ufw --force reset >/dev/null 2>&1 || true');
    const f = await audit();
    expect(f).toMatchObject({
      sshPort: 22,
      passwordAuth: false, // the image turns it off
      pubkeyAuth: true,
      firewallTool: 'ufw',
      firewallActive: false,
      pkg: 'apt',
      authorizedKeys: 1,
    });
    expect(typeof f.updatesCount).toBe('number');
    expect(f.diskRootPercent).toBeGreaterThan(0);
    expect(f.publicPorts).toContain(22);
    const ids = evaluate(f).map((x) => x.id);
    expect(ids).toContain('firewall.off');
    expect(ids).not.toContain('ssh.password-auth');
  });

  it('finds a risky SSH setting, fixes it behind a fresh-connection check, and the undo brings it back', async () => {
    box(`printf 'PermitRootLogin yes\\n' > ${TEST_DROPIN}; systemctl reload ssh`);
    expect((await audit()).permitRootLogin).toBe('yes');
    expect(evaluate(await audit()).map((x) => x.id)).toContain('ssh.root-login');

    const fix = await run('security.ssh.harden', {
      disablePasswordAuth: false,
      disableRootLogin: true,
    });
    expect(fix.run.exitCode, fix.text).toBe(0);
    expect(fix.text).toContain('Confirmed');
    expect(sshd('permitrootlogin')).toBe('no'); // the 00- file beat the 10- one
    expect((await audit()).permitRootLogin).toBe('no');
    expect(evaluate(await audit()).map((x) => x.id)).not.toContain('ssh.root-login');
    expect(await ctx.pool.probe(id)).toBe(true);

    // Running it again changes nothing (additive, no duplicate lines).
    await run('security.ssh.harden', { disablePasswordAuth: false, disableRootLogin: true });
    expect(box('grep -c "PermitRootLogin no" /etc/ssh/sshd_config.d/00-gfv-hardening.conf')).toBe(
      '1',
    );

    const undo = await run('security.ssh.restore', { backup: fix.runId });
    expect(undo.run.exitCode, undo.text).toBe(0);
    expect(sshd('permitrootlogin')).toBe('yes');
  });

  it('the undo list tells SSH changes from firewall changes', async () => {
    const q = await ctx.runner.query(id, 'firewall.backups', {});
    if (!q.ok) throw new Error('x');
    const kinds = parseBackups(q.stdout).map((b) => b.kind);
    expect(kinds).toContain('sshd');
  });

  it('refuses to switch passwords off when the account has no SSH key', async () => {
    box('mv /home/gfv/.ssh/authorized_keys /home/gfv/.ssh/authorized_keys.bak');
    try {
      const r = await run('security.ssh.harden', {
        disablePasswordAuth: true,
        disableRootLogin: false,
      });
      expect(r.run.exitCode).not.toBe(0);
      expect(r.text).toContain('no SSH key');
      expect(box('ls /etc/ssh/sshd_config.d')).not.toContain('00-gfv-hardening.conf');
    } finally {
      box('mv /home/gfv/.ssh/authorized_keys.bak /home/gfv/.ssh/authorized_keys');
    }
  });

  it('if GFV never confirms, the SERVER puts the SSH settings back by itself', async () => {
    // Run the guarded commands by hand and "forget" the last one (the confirmation): this is what a lockout looks like.
    const c = await ctx.runner.ctxFor(id);
    const p = previewAction(
      'security.ssh.harden',
      { disablePasswordAuth: false, disableRootLogin: true },
      { ...c, runId: 'timer-test-0001' },
    );
    if (!p.ok) throw new Error('x');
    const all = p.preview.commands.slice(0, -1); // everything but the confirmation
    for (const cmd of all) expect((await remote(cmd)).code, cmd).toBe(0);
    expect(sshd('permitrootlogin')).toBe('no');
    await new Promise((r) => setTimeout(r, 48_000));
    expect(sshd('permitrootlogin')).toBe('yes'); // back to the 10-gfv-test.conf value
    expect(box('ls /home/gfv/.gfv/guard/timer-test-0001')).toMatch(/reverted/);
    // sanity: the guard definition used here is the real one
    expect(guardStartCommands(sshdGuard, 'x'.repeat(8), 't', c).length).toBe(3);
  });

  it('installs fail2ban, automatic updates and package updates for real, and the checkup notices', async () => {
    const f2b = await run('security.fail2ban.install');
    expect(f2b.run.exitCode, f2b.text).toBe(0);
    const auto = await run('security.auto-updates.enable');
    expect(auto.run.exitCode, auto.text).toBe(0);
    const up = await run('security.updates.apply');
    expect(up.run.exitCode, up.text).toBe(0);
    const f = await audit();
    expect(f.fail2ban).toBe('active');
    expect(f.autoUpdates).toBe(true);
    const ids = evaluate(f).map((x) => x.id);
    expect(ids).not.toContain('fail2ban.missing');
    expect(ids).not.toContain('updates.auto-off');
    expect(ids).not.toContain('updates.security');
  });

  it('schedules a backup with a real systemd timer, runs it, prunes it, and a timer fires on its own', async () => {
    const spec = { name: 'etc-test', paths: ['/etc/ssh'], frequency: 'daily', hour: 3, keep: 2 };
    const sch = await run('backup.schedule', spec);
    expect(sch.run.exitCode, sch.text).toBe(0);
    const list = async () => {
      const q = await ctx.runner.query(id, 'backup.list', {});
      if (!q.ok) throw new Error('x');
      return parseBackupJobs(q.stdout);
    };
    let job = (await list()).find((j) => j.name === 'etc-test')!;
    expect(job).toMatchObject({
      frequency: 'daily',
      hour: 3,
      keep: 2,
      paths: ['/etc/ssh'],
      active: true,
    });
    expect(job.nextAt).toBeGreaterThan(Date.now() / 1000);
    expect(box('systemctl is-enabled gfv-backup-etc-test.timer')).toBe('enabled');

    for (let i = 0; i < 3; i++) {
      const r = await run('backup.run-now', { name: 'etc-test' });
      expect(r.run.exitCode, r.text).toBe(0);
      await new Promise((res) => setTimeout(res, 1200)); // archive names have second resolution
    }
    job = (await list()).find((j) => j.name === 'etc-test')!;
    expect(job.archives).toHaveLength(2); // keep=2: the oldest was deleted
    expect(job.last).toBe('success');
    expect(box('stat -c %U /home/gfv/.gfv/backups/etc-test/*.tar.gz | sort -u')).toBe('gfv'); // owned by the SSH user

    // Restore into a NEW folder: live files untouched, contents there.
    const archive = job.archives[0]!.name;
    const rest = await run('backup.restore', { name: 'etc-test', archive });
    expect(rest.run.exitCode, rest.text).toBe(0);
    expect(box('ls /home/gfv/gfv-restore/*/etc/ssh')).toContain('sshd_config');

    // The REAL timer: make it fire every 10 seconds and wait for an archive nobody asked for.
    const before = (await list()).find((j) => j.name === 'etc-test')!.archives.length;
    box(
      "sed -i 's#^OnCalendar=.*#OnCalendar=*-*-* *:*:00,10,20,30,40,50#; s#^Persistent=.*#Persistent=false#' /etc/systemd/system/gfv-backup-etc-test.timer; systemctl daemon-reload; systemctl restart gfv-backup-etc-test.timer",
    );
    const newest = job.archives[0]!.name;
    let fired = false;
    for (let i = 0; i < 12 && !fired; i++) {
      await new Promise((res) => setTimeout(res, 3000));
      const now = (await list()).find((j) => j.name === 'etc-test')!;
      fired = now.archives[0]!.name !== newest && before > 0;
    }
    expect(fired, 'the systemd timer should have made a new archive by itself').toBe(true);

    // Delete one archive, then remove the schedule: archives stay.
    const mid = (await list()).find((j) => j.name === 'etc-test')!;
    expect(
      (await run('backup.delete-archive', { name: 'etc-test', archive: mid.archives.at(-1)!.name }))
        .run.exitCode,
    ).toBe(0);
    expect((await run('backup.remove', { name: 'etc-test' })).run.exitCode).toBe(0);
    expect(box('ls /etc/systemd/system | grep -c gfv-backup-etc-test || true')).toBe('0');
    expect((await list()).find((j) => j.name === 'etc-test')).toBeUndefined();
    expect(box('ls /home/gfv/.gfv/backups/etc-test | wc -l')).not.toBe('0');
  });

  it('refuses a hostile backup name or path before anything reaches the server', async () => {
    for (const params of [
      { name: 'x; reboot', paths: ['/etc'], frequency: 'daily', hour: 1, keep: 1 },
      { name: 'ok', paths: ['/etc; reboot'], frequency: 'daily', hour: 1, keep: 1 },
    ]) {
      const r = await call('POST', '/api/runs', {
        serverId: id,
        actionId: 'backup.schedule',
        params,
        confirmed: true,
      });
      expect(r.statusCode).toBe(400);
    }
  });
});
