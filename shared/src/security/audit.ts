/**
 * The security checkup: ONE read-only command prints `key=value` lines (`AUDIT_COMMAND`), a pure parser turns them
 * into facts, and a pure function turns facts into findings. Nothing here changes a server: a finding may point at
 * a fix, which is an ordinary Action with its own preview and confirmation.
 */

/** Everything is best effort: a check that cannot run prints nothing and the finding is simply not made. */
export const AUDIT_COMMAND = (sudo: string): string => {
  const s = sudo;
  const lines = [
    // SSH daemon: the EFFECTIVE configuration (sshd -T merges the main file, sshd_config.d and defaults).
    `${s}sshd -T 2>/dev/null | grep -Ei '^(permitrootlogin|passwordauthentication|pubkeyauthentication|permitemptypasswords|port) ' | sed 's/^/sshd./;s/ /=/'`,
    // Firewall.
    `if command -v ufw >/dev/null 2>&1; then echo "firewall.tool=ufw"; ${s}ufw status 2>/dev/null | grep -qi '^Status: active' && echo "firewall.active=yes" || echo "firewall.active=no";` +
      ` elif command -v firewall-cmd >/dev/null 2>&1; then echo "firewall.tool=firewalld"; systemctl is-active firewalld >/dev/null 2>&1 && echo "firewall.active=yes" || echo "firewall.active=no";` +
      ` else echo "firewall.tool=none"; echo "firewall.active=no"; fi`,
    // Updates.
    `if command -v apt-get >/dev/null 2>&1; then echo "pkg=apt"; up=$(apt-get -s upgrade 2>/dev/null | grep '^Inst'); ` +
      `echo "updates.count=$(printf '%s' "$up" | grep -c .)"; echo "updates.security=$(printf '%s' "$up" | grep -ci security)"; ` +
      `dpkg -s unattended-upgrades >/dev/null 2>&1 && grep -qs 'Unattended-Upgrade "1"' /etc/apt/apt.conf.d/20auto-upgrades && echo "autoupdates=yes" || echo "autoupdates=no"; ` +
      `elif command -v dnf >/dev/null 2>&1; then echo "pkg=dnf"; n=$(dnf -q check-update 2>/dev/null | grep -cE '^[A-Za-z0-9_.+-]+\\.[a-z0-9_]+ '); echo "updates.count=$n"; ` +
      `systemctl is-enabled dnf-automatic.timer >/dev/null 2>&1 && echo "autoupdates=yes" || echo "autoupdates=no"; fi`,
    `[ -e /var/run/reboot-required ] && echo "reboot=yes" || echo "reboot=no"`,
    // Brute-force protection.
    `if command -v fail2ban-client >/dev/null 2>&1; then systemctl is-active fail2ban >/dev/null 2>&1 && echo "fail2ban=active" || echo "fail2ban=installed"; else echo "fail2ban=missing"; fi`,
    // Accounts.
    `echo "uid0=$(awk -F: '$3==0 && $1!="root" {printf "%s ", $1}' /etc/passwd | sed 's/ $//')"`,
    `echo "emptypw=$(${s}awk -F: '$2=="" {printf "%s ", $1}' /etc/shadow 2>/dev/null | sed 's/ $//')"`,
    `echo "authkeys=$(grep -cE '^(ssh-|ecdsa-|sk-)' "$HOME/.ssh/authorized_keys" 2>/dev/null || echo 0)"`,
    // Disk and exposure.
    `echo "disk.root=$(df --output=pcent / 2>/dev/null | tail -1 | tr -dc '0-9')"`,
    `echo "ports.public=$(ss -H -lnt 2>/dev/null | awk '{print $4}' | grep -E '^(0\\.0\\.0\\.0|\\*|\\[::\\]):' | sed 's/.*://' | sort -un | tr '\\n' ' ' | sed 's/ $//')"`,
  ];
  return lines.join('; ');
};

export interface AuditFacts {
  sshPort?: number;
  permitRootLogin?: string;
  passwordAuth?: boolean;
  pubkeyAuth?: boolean;
  permitEmptyPasswords?: boolean;
  firewallTool?: 'ufw' | 'firewalld' | 'none';
  firewallActive?: boolean;
  pkg?: 'apt' | 'dnf';
  updatesCount?: number;
  updatesSecurity?: number;
  autoUpdates?: boolean;
  rebootRequired?: boolean;
  fail2ban?: 'active' | 'installed' | 'missing';
  extraRootAccounts: string[];
  emptyPasswords: string[];
  authorizedKeys?: number;
  diskRootPercent?: number;
  publicPorts: number[];
}

/** Parses the `key=value` output. Unknown or malformed lines are ignored, so a partial answer still works. */
export function parseAudit(text: string): AuditFacts {
  const kv = new Map<string, string>();
  for (const line of text.split('\n')) {
    const m = /^([a-z0-9.]+)=(.*)$/.exec(line.trim());
    if (m) kv.set(m[1]!, m[2]!.trim());
  }
  const num = (k: string) => {
    const v = kv.get(k);
    return v !== undefined && /^\d+$/.test(v) ? Number(v) : undefined;
  };
  const yes = (k: string) => (kv.has(k) ? kv.get(k) === 'yes' : undefined);
  const words = (k: string) => (kv.get(k) ?? '').split(/\s+/).filter(Boolean);
  const tool = kv.get('firewall.tool');
  const f2b = kv.get('fail2ban');
  const pkg = kv.get('pkg');
  return {
    ...(num('sshd.port') !== undefined ? { sshPort: num('sshd.port')! } : {}),
    ...(kv.has('sshd.permitrootlogin') ? { permitRootLogin: kv.get('sshd.permitrootlogin')! } : {}),
    ...(yes('sshd.passwordauthentication') !== undefined
      ? { passwordAuth: yes('sshd.passwordauthentication')! }
      : {}),
    ...(yes('sshd.pubkeyauthentication') !== undefined
      ? { pubkeyAuth: yes('sshd.pubkeyauthentication')! }
      : {}),
    ...(yes('sshd.permitemptypasswords') !== undefined
      ? { permitEmptyPasswords: yes('sshd.permitemptypasswords')! }
      : {}),
    ...(tool === 'ufw' || tool === 'firewalld' || tool === 'none' ? { firewallTool: tool } : {}),
    ...(yes('firewall.active') !== undefined ? { firewallActive: yes('firewall.active')! } : {}),
    ...(pkg === 'apt' || pkg === 'dnf' ? { pkg } : {}),
    ...(num('updates.count') !== undefined ? { updatesCount: num('updates.count')! } : {}),
    ...(num('updates.security') !== undefined ? { updatesSecurity: num('updates.security')! } : {}),
    ...(yes('autoupdates') !== undefined ? { autoUpdates: yes('autoupdates')! } : {}),
    ...(yes('reboot') !== undefined ? { rebootRequired: yes('reboot')! } : {}),
    ...(f2b === 'active' || f2b === 'installed' || f2b === 'missing' ? { fail2ban: f2b } : {}),
    extraRootAccounts: words('uid0'),
    emptyPasswords: words('emptypw'),
    ...(num('authkeys') !== undefined ? { authorizedKeys: num('authkeys')! } : {}),
    ...(num('disk.root') !== undefined ? { diskRootPercent: num('disk.root')! } : {}),
    publicPorts: words('ports.public')
      .filter((p) => /^\d+$/.test(p))
      .map(Number),
  };
}

export type Severity = 'high' | 'medium' | 'low' | 'info';

export interface Finding {
  id: string;
  severity: Severity;
  title: string;
  /** What it means and why it matters, in plain words. */
  detail: string;
  /** A one-click fix: an Action (previewed and confirmed like any other) or an app that handles it. */
  fix?:
    | { kind: 'action'; actionId: string; params?: object; label: string }
    | { kind: 'app'; appId: string; label: string };
}

const SEVERITY_RANK: Record<Severity, number> = { high: 0, medium: 1, low: 2, info: 3 };

/** Turns facts into findings, worst first. Only problems are listed: no finding means that check passed. */
export function evaluate(f: AuditFacts): Finding[] {
  const out: Finding[] = [];
  const keys = f.authorizedKeys ?? 0;

  if (f.passwordAuth === true) {
    out.push({
      id: 'ssh.password-auth',
      severity: keys > 0 ? 'high' : 'medium',
      title: 'Anyone on the internet can try to guess a password for SSH',
      detail:
        keys > 0
          ? 'Password logins are on. Bots try passwords on every public server all day. You already have an SSH key on this account, so you can switch passwords off and log in with the key only.'
          : 'Password logins are on, and this account has no SSH key yet, so turning them off now would lock you out. Add an SSH key to ~/.ssh/authorized_keys first (GFV can then switch passwords off).',
      ...(keys > 0
        ? {
            fix: {
              kind: 'action' as const,
              actionId: 'security.ssh.harden',
              params: { disablePasswordAuth: true, disableRootLogin: false },
              label: 'Turn off password logins…',
            },
          }
        : {}),
    });
  }
  if (f.permitRootLogin === 'yes') {
    out.push({
      id: 'ssh.root-login',
      severity: 'high',
      title: 'The root account can log in over SSH',
      detail:
        'Every attacker already knows the account name "root". Logging in as a normal user and using sudo removes that easy target.',
      fix: {
        kind: 'action',
        actionId: 'security.ssh.harden',
        params: { disablePasswordAuth: false, disableRootLogin: true },
        label: 'Forbid root logins…',
      },
    });
  }
  if (f.permitEmptyPasswords === true) {
    out.push({
      id: 'ssh.empty-passwords',
      severity: 'high',
      title: 'SSH accepts accounts with an empty password',
      detail:
        'An account with no password could be entered by anyone. Turn "PermitEmptyPasswords" off in sshd_config.',
    });
  }
  if (f.firewallActive === false) {
    out.push({
      id: 'firewall.off',
      severity: 'high',
      title: 'There is no firewall protecting this server',
      detail:
        'Without a firewall every program that listens on a port is reachable from the whole internet, including ones you forgot about.',
      fix: { kind: 'app', appId: 'firewall', label: 'Open the Firewall app' },
    });
  }
  if ((f.updatesSecurity ?? 0) > 0) {
    out.push({
      id: 'updates.security',
      severity: 'high',
      title: `${f.updatesSecurity} security update${f.updatesSecurity === 1 ? '' : 's'} waiting`,
      detail: 'These fix known vulnerabilities that attackers already use. Install them soon.',
      fix: { kind: 'action', actionId: 'security.updates.apply', label: 'Install updates…' },
    });
  } else if ((f.updatesCount ?? 0) > 0) {
    out.push({
      id: 'updates.pending',
      severity: 'low',
      title: `${f.updatesCount} package update${f.updatesCount === 1 ? '' : 's'} waiting`,
      detail: 'Not marked as security fixes, but staying current avoids surprises later.',
      fix: { kind: 'action', actionId: 'security.updates.apply', label: 'Install updates…' },
    });
  }
  if (f.rebootRequired === true) {
    out.push({
      id: 'reboot',
      severity: 'medium',
      title: 'The server needs a restart',
      detail:
        'An update (usually the kernel) is installed but not active until the server restarts.',
    });
  }
  if (f.autoUpdates === false) {
    out.push({
      id: 'updates.auto-off',
      severity: 'medium',
      title: 'Security updates are not installed automatically',
      detail:
        'Turn on automatic security updates so a forgotten server does not stay vulnerable for months.',
      fix: {
        kind: 'action',
        actionId: 'security.auto-updates.enable',
        label: 'Turn on automatic updates…',
      },
    });
  }
  if (f.fail2ban === 'missing') {
    out.push({
      id: 'fail2ban.missing',
      severity: 'low',
      title: 'Nothing blocks addresses that keep guessing passwords',
      detail: 'fail2ban watches the logs and blocks an address after repeated failed logins.',
      fix: { kind: 'action', actionId: 'security.fail2ban.install', label: 'Install fail2ban…' },
    });
  } else if (f.fail2ban === 'installed') {
    out.push({
      id: 'fail2ban.stopped',
      severity: 'low',
      title: 'fail2ban is installed but not running',
      detail: 'Start it with the Services app (fail2ban.service).',
      fix: { kind: 'app', appId: 'services', label: 'Open Services' },
    });
  }
  if (f.extraRootAccounts.length) {
    out.push({
      id: 'accounts.uid0',
      severity: 'high',
      title: `Other accounts have full root powers: ${f.extraRootAccounts.join(', ')}`,
      detail: 'Only "root" should have user id 0. Anything else with it is a classic backdoor.',
    });
  }
  if (f.emptyPasswords.length) {
    out.push({
      id: 'accounts.empty-password',
      severity: 'high',
      title: `Accounts without a password: ${f.emptyPasswords.join(', ')}`,
      detail: 'Lock them with "sudo passwd -l <name>" or set a password.',
    });
  }
  if ((f.diskRootPercent ?? 0) >= 90) {
    out.push({
      id: 'disk.full',
      severity: 'medium',
      title: `The disk is ${f.diskRootPercent}% full`,
      detail: 'A full disk stops databases, logs and updates. Free some space soon.',
      fix: { kind: 'app', appId: 'files', label: 'Open Files' },
    });
  }
  const ssh = f.sshPort ?? 22;
  const unusual = f.publicPorts.filter((p) => ![ssh, 22, 80, 443].includes(p));
  if (unusual.length) {
    out.push({
      id: 'ports.unusual',
      severity: 'info',
      title: `Also reachable from the internet: ${unusual.join(', ')}`,
      detail:
        'Check that each of these should be public. Databases and admin tools usually should not be.',
      fix: { kind: 'app', appId: 'network', label: 'Open Network' },
    });
  }
  return out.sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity]);
}

// ---- the sshd hardening file -------------------------------------------------------------------------------------

export const SSHD_DROPIN = '/etc/ssh/sshd_config.d/00-gfv-hardening.conf';

/**
 * The drop-in's text. `00-` makes it win: sshd keeps the FIRST value it sees and reads sshd_config.d in name order, so
 * a file like 50-cloud-init.conf (which often sets PasswordAuthentication yes) cannot override it.
 */
export function renderHardening(o: {
  disablePasswordAuth: boolean;
  disableRootLogin: boolean;
}): string {
  return [
    '# Managed by GFV (Security checkup). Remove this file to go back to the defaults.',
    ...(o.disablePasswordAuth
      ? ['PasswordAuthentication no', 'KbdInteractiveAuthentication no']
      : []),
    ...(o.disableRootLogin ? ['PermitRootLogin no'] : []),
    '',
  ].join('\n');
}
