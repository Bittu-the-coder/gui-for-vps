import { describe, expect, it } from 'vitest';
import { previewAction } from '../actions/index.js';
import {
  blocksSsh,
  fromCovers,
  parseBackups,
  parseStatus,
  removesSshAccess,
  ruleMatch,
  ruleSchema,
} from './ufw.js';

const rule = (r: object) => ruleSchema.parse(r);

describe('rule validation', () => {
  it('accepts normal rules and builds the ufw words', () => {
    expect(ruleMatch(rule({ policy: 'allow', port: '80' }))).toBe(
      'from any to any port 80 proto tcp',
    );
    expect(ruleMatch(rule({ policy: 'deny', port: '8000:8100', proto: 'udp' }))).toBe(
      'from any to any port 8000:8100 proto udp',
    );
    expect(ruleMatch(rule({ policy: 'allow', from: '10.0.0.0/8', proto: 'any' }))).toBe(
      'from 10.0.0.0/8 to any',
    );
  });
  it('refuses anything that could carry shell or ufw syntax', () => {
    for (const bad of [
      { policy: 'allow', port: '80; rm -rf /' },
      { policy: 'allow', port: '$(id)' },
      { policy: 'allow', port: '80', from: '1.2.3.4; reboot' },
      { policy: 'allow', port: '80', from: 'evil.example.com' },
      { policy: 'allow', port: '80', from: '999.1.1.1' },
      { policy: 'allow', port: '70000' },
      { policy: 'allow', port: '90:80' },
      { policy: 'allow', port: '80', proto: 'icmp' },
      { policy: 'allow', port: '80:90', proto: 'any' },
      { policy: 'allow' }, // every port from anywhere
      { policy: 'in', port: '80' },
    ])
      expect(ruleSchema.safeParse(bad).success, JSON.stringify(bad)).toBe(false);
  });
});

describe('lockout detection', () => {
  it('a deny that covers the SSH port from GFV is dangerous; other denies are not', () => {
    expect(blocksSsh(rule({ policy: 'deny', port: '22' }), 22, '172.20.0.1')).toBe(true);
    expect(blocksSsh(rule({ policy: 'deny', port: '2222' }), 2222, '172.20.0.1')).toBe(true);
    expect(blocksSsh(rule({ policy: 'deny', port: '20:30' }), 22, '172.20.0.1')).toBe(true);
    expect(blocksSsh(rule({ policy: 'deny', port: '80' }), 22, '172.20.0.1')).toBe(false);
    expect(blocksSsh(rule({ policy: 'deny', port: '22', proto: 'udp' }), 22, '172.20.0.1')).toBe(
      false,
    );
    expect(blocksSsh(rule({ policy: 'deny', port: '22', from: '8.8.8.8' }), 22, '172.20.0.1')).toBe(
      false,
    );
    expect(
      blocksSsh(rule({ policy: 'deny', port: '22', from: '172.20.0.0/16' }), 22, '172.20.0.1'),
    ).toBe(true);
    expect(
      blocksSsh(rule({ policy: 'deny', from: '172.20.0.1', proto: 'any' }), 22, '172.20.0.1'),
    ).toBe(true);
    expect(blocksSsh(rule({ policy: 'allow', port: '22' }), 22, '172.20.0.1')).toBe(false);
  });
  it('removing an allow that covers SSH is dangerous', () => {
    expect(removesSshAccess(rule({ policy: 'allow', port: '22' }), 22, '1.2.3.4')).toBe(true);
    expect(removesSshAccess(rule({ policy: 'limit', port: '22' }), 22, '1.2.3.4')).toBe(true);
    expect(removesSshAccess(rule({ policy: 'allow', port: '80' }), 22, '1.2.3.4')).toBe(false);
  });
  it('without knowing the address, a source-limited rule is assumed to cover it (safe side)', () => {
    expect(fromCovers('8.8.8.8', undefined)).toBe(true);
    expect(fromCovers('10.1.2.3', '10.1.2.9')).toBe(false);
    expect(fromCovers('10.1.0.0/16', '10.1.2.9')).toBe(true);
    expect(fromCovers('0.0.0.0/0', '10.1.2.9')).toBe(true);
  });
  it('the preview of a deny on SSH is raised to danger, and of a deny on port 80 is not', () => {
    const ctx = { sudo: 'sudo -n ', sshPort: 22, clientIp: '172.20.0.1' };
    const ssh = previewAction('firewall.allow', { policy: 'deny', port: '22' }, ctx);
    const web = previewAction('firewall.allow', { policy: 'deny', port: '80' }, ctx);
    expect(ssh.ok && ssh.preview.risk).toBe('danger');
    expect(web.ok && web.preview.risk).toBe('caution');
    const del = previewAction('firewall.delete', { policy: 'allow', port: '22' }, ctx);
    expect(del.ok && del.preview.risk).toBe('danger');
  });
});

const STATUS = `Status: active
Logging: on (low)
Default: deny (incoming), allow (outgoing), deny (routed)
New profiles: skip

To                         Action      From
--                         ------      ----
22/tcp                     ALLOW IN    Anywhere
80/tcp                     ALLOW IN    Anywhere
8000:8100/tcp              DENY IN     10.0.0.0/8
Anywhere                   LIMIT IN    203.0.113.7
22/tcp (v6)                ALLOW IN    Anywhere (v6)
80/tcp (v6)                ALLOW IN    Anywhere (v6)
443/tcp (v6)               ALLOW IN    Anywhere (v6)
53                         ALLOW OUT   Anywhere
`;

describe('parsing ufw status', () => {
  it('reads the SSH port and address of this connection', () => {
    const s = parseStatus('SSHCONN:172.20.0.1 33918 172.20.0.5 22\nStatus: inactive\n');
    expect(s).toMatchObject({ sshPort: 22, clientIp: '172.20.0.1', active: false });
  });
  it('reads state, default and rules, hides IPv6 twins, ignores outgoing rules', () => {
    const s = parseStatus(STATUS);
    expect(s).toMatchObject({ installed: true, active: true, defaultIncoming: 'deny' });
    expect(
      s.rules.map((r) => `${r.policy} ${r.port ?? '*'}/${r.proto} ${r.from}${r.v6 ? ' v6' : ''}`),
    ).toEqual([
      'allow 22/tcp any',
      'allow 80/tcp any',
      'deny 8000:8100/tcp 10.0.0.0/8',
      'limit */any 203.0.113.7',
      'allow 443/tcp any v6', // only has an IPv6 row: still shown
    ]);
  });
  it('knows inactive, missing and refused', () => {
    expect(parseStatus('Status: inactive\n')).toMatchObject({
      installed: true,
      active: false,
      rules: [],
    });
    expect(parseStatus('NO_UFW\n').installed).toBe(false);
    expect(parseStatus('ERROR: You need to be root to run this script').error).toContain('root');
  });
});

describe('undo points', () => {
  it('parses the listing newest first', () => {
    const b = parseBackups(
      '==BACKUP:aaaaaaaa-1\nAdd a firewall rule\n1000\n==OK\n==BACKUP:bbbbbbbb-2\nTurn the firewall off\n2000\n==REVERTED\n',
    );
    expect(b).toEqual([
      {
        id: 'bbbbbbbb-2',
        title: 'Turn the firewall off',
        kind: 'ufw',
        at: 2000,
        confirmed: false,
        reverted: true,
      },
      {
        id: 'aaaaaaaa-1',
        title: 'Add a firewall rule',
        kind: 'ufw',
        at: 1000,
        confirmed: true,
        reverted: false,
      },
    ]);
  });
  it('restore accepts only a plain id, never a path', () => {
    for (const bad of ['../x', 'a/b', '', 'x y', '$(id)'])
      expect(previewAction('firewall.restore', { backup: bad }).ok).toBe(false);
    expect(previewAction('firewall.restore', { backup: 'abcdef12-3456' }).ok).toBe(true);
  });
});

describe('the guard wrapper', () => {
  const ctx = { sudo: 'sudo -n ', sshPort: 22 };
  it('puts the save + timer first, the confirm last, and says so in the preview', () => {
    const p = previewAction(
      'firewall.allow',
      { policy: 'allow', port: '80' },
      { ...ctx, runId: 'run-12345678' },
    );
    if (!p.ok) throw new Error('preview failed');
    const c = p.preview.commands;
    expect(c[0]).toContain('mkdir -p -m 700');
    expect(c.join('\n')).toContain('cp -a /etc/ufw');
    expect(c.join('\n')).toContain('Safety timer set');
    expect(c.at(-2)).toContain('ufw allow from any to any port 80 proto tcp');
    const deny = previewAction(
      'firewall.allow',
      { policy: 'deny', port: '80' },
      { ...ctx, runId: 'run-12345678' },
    );
    expect(deny.ok && deny.preview.commands.at(-2)).toContain(
      'ufw insert 1 deny from any to any port 80',
    );
    expect(c.at(-1)).toContain('/ok');
    expect(p.preview.guard).toEqual({ seconds: 40, confirmIndex: c.length - 1 });
  });
  it('enabling the firewall allows the SSH port FIRST', () => {
    const p = previewAction(
      'firewall.enable',
      {},
      { ...ctx, sshPort: 2222, runId: 'run-12345678' },
    );
    if (!p.ok) throw new Error('x');
    const c = p.preview.commands;
    const allow = c.indexOf('sudo -n ufw allow 2222/tcp');
    const enable = c.indexOf('sudo -n ufw --force enable');
    expect(allow).toBeGreaterThan(-1);
    expect(enable).toBeGreaterThan(allow);
  });
});
