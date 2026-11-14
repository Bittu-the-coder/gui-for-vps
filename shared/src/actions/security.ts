import { z } from 'zod';
import { apt, aptUpdate, DISTRO_GUARD, DNF_GUARD } from '../devhub/tools.js';
import { AUDIT_COMMAND, SSHD_DROPIN } from '../security/audit.js';
import { GUARD_ID, GUARD_ROOT, type GuardDef } from '../guard.js';
import { shellQuote } from '../shell.js';
import { defineAction, type ActionCtx } from './define.js';

/**
 * The security checkup's fixes. Reading is one quiet command; every fix is an ordinary Action. The one that could cut
 * GFV's own access (changing how SSH logs in) is GUARDED like the firewall (see guard.ts).
 */

export const securityAudit = defineAction({
  id: 'security.audit',
  title: 'Security checkup',
  explain:
    'Reads (never changes) the settings that matter most: the effective SSH configuration (sshd -T), whether a firewall is on, pending updates, automatic updates, fail2ban, accounts with root powers or no password, disk usage and which ports are open to the internet.',
  params: z.object({}),
  commands: (_p, ctx) => [AUDIT_COMMAND(ctx.sudo)],
  risk: 'safe',
  recordable: false,
  quiet: true,
  queryTimeoutMs: 60_000,
  internal: true,
});

const reloadSsh = (ctx: ActionCtx) =>
  `(${ctx.sudo}systemctl reload ssh 2>/dev/null || ${ctx.sudo}systemctl reload sshd)`;

/** sshd settings live in /etc/ssh/sshd_config.d on modern systems: save that folder, put it back, reload sshd. */
export const sshdGuard: GuardDef = {
  kind: 'sshd',
  seconds: 40,
  save: (ctx) =>
    `${ctx.sudo}mkdir -p /etc/ssh/sshd_config.d && ${ctx.sudo}cp -a /etc/ssh/sshd_config.d "$DIR/sshd_config.d"`,
  restore: (ctx) =>
    `${ctx.sudo}rm -rf /etc/ssh/sshd_config.d && ${ctx.sudo}cp -a "$DIR/sshd_config.d" /etc/ssh/sshd_config.d && ${reloadSsh(ctx)}`,
};

const HAS_INCLUDE =
  `grep -qE '^[[:space:]]*Include[[:space:]]+/etc/ssh/sshd_config.d' /etc/ssh/sshd_config || ` +
  '{ echo "This server\'s sshd_config does not read /etc/ssh/sshd_config.d, so GFV cannot change SSH safely here." >&2; exit 1; }';
const HAS_KEY =
  `[ "$(grep -cE '^(ssh-|ecdsa-|sk-)' "$HOME/.ssh/authorized_keys" 2>/dev/null || echo 0)" -ge 1 ] || ` +
  '{ echo "This account has no SSH key in ~/.ssh/authorized_keys: turning passwords off now would lock you out. Add a key first." >&2; exit 1; }';

export const hardenSsh = defineAction({
  id: 'security.ssh.harden',
  title: 'Harden SSH logins',
  explain:
    'Adds the lines you choose to a drop-in file, /etc/ssh/sshd_config.d/00-gfv-hardening.conf ("00" so it is read first: sshd keeps the first value it sees), checks the whole configuration with `sshd -t`, then reloads sshd. Your current connection keeps working; new logins follow the new rules.',
  params: z
    .object({ disablePasswordAuth: z.boolean(), disableRootLogin: z.boolean() })
    .refine((p) => p.disablePasswordAuth || p.disableRootLogin, 'Choose at least one change'),
  guard: sshdGuard,
  commands: (p, ctx) => {
    const lines = [
      ...(p.disablePasswordAuth
        ? ['PasswordAuthentication no', 'KbdInteractiveAuthentication no']
        : []),
      ...(p.disableRootLogin ? ['PermitRootLogin no'] : []),
    ];
    // Additive: lines are appended only when missing, so an earlier change in the same file is kept.
    const script =
      `f=${shellQuote(SSHD_DROPIN)}; [ -e "$f" ] || printf '%s\\n' '# Managed by GFV (Security checkup). Remove this file to go back to the defaults.' > "$f"; ` +
      `for l in ${lines.map(shellQuote).join(' ')}; do grep -qxF "$l" "$f" || printf '%s\\n' "$l" >> "$f"; done`;
    const dir = `"$HOME/${GUARD_ROOT}/${ctx.runId ?? 'preview'}"`;
    return [
      HAS_INCLUDE,
      ...(p.disablePasswordAuth ? [HAS_KEY] : []),
      `${ctx.sudo}sh -c ${shellQuote(script)}`,
      // A bad configuration would stop sshd from restarting: undo at once instead of waiting for the timer.
      `${ctx.sudo}sshd -t || { DIR=${dir}; ${sshdGuard.restore(ctx)}; echo "sshd rejected this configuration, so nothing was changed." >&2; exit 1; }`,
      reloadSsh(ctx),
    ];
  },
  risk: 'caution',
  riskReason:
    'Changes how everyone logs in to this server. GFV saves the current settings first, proves it can still open a NEW connection afterwards, and the server undoes the change by itself if not.',
  recordable: false,
  internal: true,
});

export const restoreSsh = defineAction({
  id: 'security.ssh.restore',
  title: 'Undo an SSH change',
  explain:
    'Puts the SSH settings back the way they were before an earlier change, from the copy GFV saved on the server. Guarded like any SSH change, and it saves the current settings first, so it can be undone too.',
  params: z.object({ backup: z.string().regex(GUARD_ID) }),
  guard: sshdGuard,
  commands: (p, ctx) => {
    const dir = `"$HOME/${GUARD_ROOT}/${p.backup}"`;
    return [
      `[ -d ${dir}/sshd_config.d ] || { echo "That undo point does not exist (any more)." >&2; exit 1; }`,
      `DIR=${dir}; ${sshdGuard.restore(ctx)}`,
    ];
  },
  risk: 'caution',
  riskReason: 'Changes how everyone logs in to this server (guarded: see above).',
  recordable: false,
  internal: true,
});

export const applyUpdates = defineAction({
  id: 'security.updates.apply',
  title: 'Install package updates',
  explain:
    'Installs every available update for the packages already on the server (apt upgrade, or dnf upgrade). It does not remove packages or restart the server; some updates restart their service.',
  params: z.object({}),
  commands: (_p, ctx) =>
    ctx.pkg === 'dnf'
      ? [DNF_GUARD, `${ctx.sudo}dnf -y -q upgrade`]
      : [DISTRO_GUARD, aptUpdate(ctx), apt(ctx, '-o Dpkg::Options::=--force-confold upgrade')],
  risk: 'caution',
  riskReason:
    'Updates can restart services (a website may blink for a moment) and take several minutes.',
  longRunning: true,
  recordable: false,
  internal: true,
});

export const enableAutoUpdates = defineAction({
  id: 'security.auto-updates.enable',
  title: 'Turn on automatic security updates',
  explain:
    'Installs the automatic-update service of your system (unattended-upgrades on Ubuntu/Debian, dnf-automatic on Fedora/RHEL) and switches it on, so security fixes arrive without you logging in.',
  params: z.object({}),
  commands: (_p, ctx) =>
    ctx.pkg === 'dnf'
      ? [
          DNF_GUARD,
          `${ctx.sudo}dnf -y -q install dnf-automatic`,
          `${ctx.sudo}sed -i 's/^apply_updates.*/apply_updates = yes/' /etc/dnf/automatic.conf`,
          `${ctx.sudo}systemctl enable --now dnf-automatic.timer`,
        ]
      : [
          DISTRO_GUARD,
          aptUpdate(ctx),
          apt(ctx, 'install unattended-upgrades'),
          `printf '%s\\n' 'APT::Periodic::Update-Package-Lists "1";' 'APT::Periodic::Unattended-Upgrade "1";' | ${ctx.sudo}tee /etc/apt/apt.conf.d/20auto-upgrades >/dev/null`,
          `${ctx.sudo}systemctl enable --now apt-daily.timer apt-daily-upgrade.timer`,
        ],
  risk: 'caution',
  riskReason:
    'Installs software and lets the server change itself later (only security updates by default).',
  longRunning: true,
  recordable: false,
  internal: true,
});

export const installFail2ban = defineAction({
  id: 'security.fail2ban.install',
  title: 'Install fail2ban',
  explain:
    'fail2ban reads the login logs and blocks an address for a while after repeated failed logins. The defaults already protect SSH.',
  params: z.object({}),
  commands: (_p, ctx) =>
    ctx.pkg === 'dnf'
      ? [
          DNF_GUARD,
          `${ctx.sudo}dnf -y -q install fail2ban`,
          `${ctx.sudo}systemctl enable --now fail2ban`,
        ]
      : [
          DISTRO_GUARD,
          aptUpdate(ctx),
          apt(ctx, 'install fail2ban'),
          `${ctx.sudo}systemctl enable --now fail2ban`,
        ],
  risk: 'caution',
  riskReason: 'Installs a package and a background service with administrator rights.',
  longRunning: true,
  recordable: false,
  internal: true,
});

export const securityActions = [
  securityAudit,
  hardenSsh,
  restoreSsh,
  applyUpdates,
  enableAutoUpdates,
  installFail2ban,
];
