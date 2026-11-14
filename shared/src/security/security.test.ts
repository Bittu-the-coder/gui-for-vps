import { describe, expect, it } from 'vitest';
import { previewAction } from '../actions/index.js';
import { backupSchema, parseBackupJobs, renderTimer } from '../backups/schedule.js';
import { AUDIT_COMMAND, evaluate, parseAudit, renderHardening } from './audit.js';

const BAD = `sshd.port=22
sshd.permitrootlogin=yes
sshd.passwordauthentication=yes
sshd.pubkeyauthentication=yes
sshd.permitemptypasswords=no
firewall.tool=ufw
firewall.active=no
pkg=apt
updates.count=12
updates.security=3
autoupdates=no
reboot=yes
fail2ban=missing
uid0=toor
emptypw=guest ftp
authkeys=2
disk.root=93
ports.public=22 80 3306 8080
`;

describe('parsing the audit output', () => {
  it('reads every fact', () => {
    expect(parseAudit(BAD)).toEqual({
      sshPort: 22,
      permitRootLogin: 'yes',
      passwordAuth: true,
      pubkeyAuth: true,
      permitEmptyPasswords: false,
      firewallTool: 'ufw',
      firewallActive: false,
      pkg: 'apt',
      updatesCount: 12,
      updatesSecurity: 3,
      autoUpdates: false,
      rebootRequired: true,
      fail2ban: 'missing',
      extraRootAccounts: ['toor'],
      emptyPasswords: ['guest', 'ftp'],
      authorizedKeys: 2,
      diskRootPercent: 93,
      publicPorts: [22, 80, 3306, 8080],
    });
  });
  it('a partial or garbled answer still parses, and makes no finding for what it does not know', () => {
    const f = parseAudit('nonsense\n\nsshd.passwordauthentication=maybe\ndisk.root=lots\n');
    expect(f.diskRootPercent).toBeUndefined();
    expect(evaluate(f)).toEqual([]);
  });
  it('the command is one line of plain shell that only reads', () => {
    const c = AUDIT_COMMAND('sudo -n ');
    expect(c).not.toContain('\n');
    expect(c).not.toMatch(
      /\b(rm|mv|tee|chmod|chown|apt-get (install|upgrade)|systemctl (start|stop|restart|enable))\b/,
    );
  });
});

describe('findings', () => {
  const ids = (f: ReturnType<typeof parseAudit>) => evaluate(f).map((x) => x.id);
  it('a bad server gets every finding, worst first', () => {
    const found = evaluate(parseAudit(BAD));
    expect(found.map((f) => f.id)).toEqual(
      expect.arrayContaining([
        'ssh.password-auth',
        'ssh.root-login',
        'firewall.off',
        'updates.security',
        'reboot',
        'updates.auto-off',
        'fail2ban.missing',
        'accounts.uid0',
        'accounts.empty-password',
        'disk.full',
        'ports.unusual',
      ]),
    );
    const ranks = found.map((f) => ['high', 'medium', 'low', 'info'].indexOf(f.severity));
    expect(ranks).toEqual([...ranks].sort((a, b) => a - b));
    expect(found.find((f) => f.id === 'ports.unusual')?.title).toContain('3306, 8080');
    expect(found.find((f) => f.id === 'ports.unusual')?.title).not.toContain('22');
  });
  it('a good server has none', () => {
    expect(
      ids(
        parseAudit(
          'sshd.permitrootlogin=prohibit-password\nsshd.passwordauthentication=no\nfirewall.active=yes\nupdates.count=0\nupdates.security=0\nautoupdates=yes\nreboot=no\nfail2ban=active\nuid0=\nemptypw=\nauthkeys=1\ndisk.root=40\nports.public=22 443\n',
        ),
      ),
    ).toEqual([]);
  });
  it('never offers to switch passwords off when there is no SSH key (that would lock you out)', () => {
    const f = evaluate(parseAudit('sshd.passwordauthentication=yes\nauthkeys=0\n'));
    const pw = f.find((x) => x.id === 'ssh.password-auth')!;
    expect(pw.fix).toBeUndefined();
    expect(pw.detail).toContain('no SSH key');
  });
  it('every fix points at a real action or app', () => {
    for (const f of evaluate(parseAudit(BAD)))
      if (f.fix?.kind === 'action') {
        const r = previewAction(f.fix.actionId, f.fix.params ?? {}, {
          sudo: 'sudo -n ',
          pkg: 'apt',
        });
        expect(r.ok, f.id).toBe(true);
      }
  });
});

describe('SSH hardening', () => {
  const ctx = { sudo: 'sudo -n ', runId: 'run-12345678' };
  it('is guarded, checks for a key and an Include, validates, and reloads', () => {
    const p = previewAction(
      'security.ssh.harden',
      { disablePasswordAuth: true, disableRootLogin: true },
      ctx,
    );
    if (!p.ok) throw new Error('x');
    const c = p.preview.commands.join('\n');
    expect(p.preview.guard?.seconds).toBe(40);
    expect(c).toContain('authorized_keys');
    expect(c).toContain('sshd_config.d');
    expect(c).toContain('PasswordAuthentication no');
    expect(c).toContain('PermitRootLogin no');
    expect(c.indexOf('sshd -t')).toBeLessThan(
      c.indexOf('systemctl reload ssh', c.indexOf('sshd -t')),
    );
    expect(c).toContain('/etc/ssh/sshd_config.d/00-gfv-hardening.conf');
  });
  it('without disabling passwords it does not demand a key', () => {
    const p = previewAction(
      'security.ssh.harden',
      { disablePasswordAuth: false, disableRootLogin: true },
      ctx,
    );
    if (!p.ok) throw new Error('x');
    expect(p.preview.commands.some((x) => x.startsWith('[ "$(grep -cE'))).toBe(false);
  });
  it('refuses to do nothing, and the undo takes only a plain id', () => {
    expect(
      previewAction('security.ssh.harden', { disablePasswordAuth: false, disableRootLogin: false })
        .ok,
    ).toBe(false);
    expect(previewAction('security.ssh.restore', { backup: '../etc' }).ok).toBe(false);
    expect(renderHardening({ disablePasswordAuth: true, disableRootLogin: false })).toContain(
      'PasswordAuthentication no',
    );
  });
});

describe('backup schedules', () => {
  const ok = { name: 'web', paths: ['/etc', '/var/www'], frequency: 'daily', hour: 3, keep: 7 };
  it('accepts a normal schedule', () => expect(backupSchema.safeParse(ok).success).toBe(true));
  it('refuses names and paths that could carry shell, systemd or tar syntax', () => {
    for (const bad of [
      { ...ok, name: 'Web' },
      { ...ok, name: 'a b' },
      { ...ok, name: '../x' },
      { ...ok, name: 'x;reboot' },
      { ...ok, paths: ['/etc; rm -rf /'] },
      { ...ok, paths: ['/etc/$(id)'] },
      { ...ok, paths: ['etc'] },
      { ...ok, paths: ['/'] },
      { ...ok, paths: ['/etc/../root'] },
      { ...ok, paths: ['/my files'] },
      { ...ok, paths: ["/it's"] },
      { ...ok, paths: [] },
      { ...ok, hour: 24 },
      { ...ok, keep: 0 },
      { ...ok, frequency: 'hourly' },
    ])
      expect(backupSchema.safeParse(bad).success, JSON.stringify(bad)).toBe(false);
  });
  it('the timer says when it runs', () => {
    expect(renderTimer(backupSchema.parse(ok))).toContain('OnCalendar=*-*-* 03:00:00');
    expect(renderTimer(backupSchema.parse({ ...ok, frequency: 'weekly', hour: 14 }))).toContain(
      'OnCalendar=Mon *-*-* 14:00:00',
    );
  });
  it('the preview writes script, service and timer, then enables the timer', () => {
    const p = previewAction('backup.schedule', ok, {
      sudo: 'sudo -n ',
      home: '/home/gfv',
      user: 'gfv',
      runId: 'r1',
    });
    if (!p.ok) throw new Error('x');
    const c = p.preview.commands.join('\n');
    expect(c).toContain('/usr/local/lib/gfv/backup-web.sh');
    expect(c).toContain('/etc/systemd/system/gfv-backup-web.timer');
    expect(c).toContain('systemctl enable --now gfv-backup-web.timer');
    expect(p.preview.snapshots.length).toBe(3); // existing files are backed up before they are overwritten
  });
  it('parses the list view', () => {
    const jobs = parseBackupJobs(
      '==BACKUP:web\nschedule=weekly 14\nkeep=5\npaths=/etc /var/www\nactive=active\nnext=Mon 2026-11-16 14:00:00 UTC\nlast=success\n==FILE:20261110-140000.tar.gz 2048 1700000000\n==FILE:20261109-140000.tar.gz 1024 1600000000\n==FILE:junk.txt 1 1\n',
    );
    expect(jobs).toHaveLength(1);
    expect(jobs[0]).toMatchObject({
      name: 'web',
      frequency: 'weekly',
      hour: 14,
      keep: 5,
      paths: ['/etc', '/var/www'],
      active: true,
      last: 'success',
    });
    expect(jobs[0]!.nextAt).toBeGreaterThan(1_700_000_000);
    expect(jobs[0]!.archives.map((a) => a.name)).toEqual([
      '20261110-140000.tar.gz',
      '20261109-140000.tar.gz',
    ]);
  });
  it('restore and delete accept only archive names, never paths', () => {
    for (const a of ['../x.tar.gz', 'a/b.tar.gz', '20261110-140000.tar.gz;id', '']) {
      expect(previewAction('backup.restore', { name: 'web', archive: a }).ok).toBe(false);
      expect(previewAction('backup.delete-archive', { name: 'web', archive: a }).ok).toBe(false);
    }
    expect(
      previewAction('backup.restore', { name: 'web', archive: '20261110-140000.tar.gz' }).ok,
    ).toBe(true);
  });
});
