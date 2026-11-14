import { z } from 'zod';
import { apt, aptUpdate, DISTRO_GUARD } from '../devhub/tools.js';
import {
  blocksSsh,
  describeRule,
  removesSshAccess,
  ruleMatch,
  ruleSchema,
} from '../firewall/ufw.js';
import { GUARD_ID, GUARD_ROOT, type GuardDef } from '../guard.js';
import { defineAction } from './define.js';

/**
 * The firewall (ufw on Ubuntu/Debian). Every change is GUARDED (see guard.ts): GFV saves the current rules on the
 * server, starts a timer that restores them, makes the change, proves with a NEW SSH connection that it can still
 * get in, and only then cancels the timer. The saved copies are also the undo timeline.
 */

// SSH_CONNECTION tells the app which port and address "this connection" uses, as the SERVER sees them.
export const STATUS_COMMAND = (sudo: string) =>
  `echo "SSHCONN:$SSH_CONNECTION"; command -v ufw >/dev/null 2>&1 || { echo NO_UFW; exit 0; }; ${sudo}ufw status verbose 2>&1`;

export const BACKUPS_COMMAND =
  `for d in "$HOME/${GUARD_ROOT}"/*/; do [ -f "$d/meta" ] || continue; echo "==BACKUP:$(basename "$d")"; cat "$d/meta"; ` +
  `[ -e "$d/ok" ] && echo "==OK"; [ -e "$d/reverted" ] && echo "==REVERTED"; done; true`;

/** What gets saved, and how it is put back. ufw keeps everything in /etc/ufw (+ one default file). */
export const ufwGuard: GuardDef = {
  kind: 'ufw',
  seconds: 40,
  save: (ctx) =>
    `${ctx.sudo}cp -a /etc/ufw "$DIR/etc-ufw" && ${ctx.sudo}cp -a /etc/default/ufw "$DIR/default-ufw"`,
  restore: (ctx) =>
    `${ctx.sudo}rm -rf /etc/ufw && ${ctx.sudo}cp -a "$DIR/etc-ufw" /etc/ufw && ${ctx.sudo}cp -a "$DIR/default-ufw" /etc/default/ufw\n` +
    `if grep -q '^ENABLED=yes' /etc/ufw/ufw.conf; then ${ctx.sudo}ufw --force disable; ${ctx.sudo}ufw --force enable; else ${ctx.sudo}ufw --force disable; fi`,
};

const NEEDS_UFW =
  'command -v ufw >/dev/null 2>&1 || { echo "ufw is not installed: install it first." >&2; exit 1; }';
const LOCKOUT =
  'This rule matches SSH, the way GFV (and you) reach this server. If it cuts that access, GFV notices within seconds and the server undoes it by itself after 40 seconds.';
const GUARDED_NOTE =
  'The firewall decides which connections reach your server. GFV saves the current rules first and undoes the change automatically if it can no longer connect.';

export const firewallStatus = defineAction({
  id: 'firewall.status',
  title: 'Show the firewall',
  explain:
    'ufw status verbose prints whether the firewall is on, what it does with connections nobody has a rule for, and every rule.',
  params: z.object({}),
  commands: (_p, ctx) => [STATUS_COMMAND(ctx.sudo)],
  risk: 'safe',
  recordable: false,
  quiet: true,
  internal: true,
});

export const firewallBackups = defineAction({
  id: 'firewall.backups',
  title: 'List firewall undo points',
  explain:
    'Reads the saved copies GFV keeps in ~/.gfv/guard on the server: one per firewall change, with the time and whether GFV confirmed it could still connect.',
  params: z.object({}),
  commands: () => [BACKUPS_COMMAND],
  risk: 'safe',
  recordable: false,
  quiet: true,
  internal: true,
});

export const firewallInstall = defineAction({
  id: 'firewall.install',
  title: 'Install the firewall (ufw)',
  explain:
    'ufw ("uncomplicated firewall") is the standard firewall tool on Ubuntu and Debian. Installing it does not turn it on: it has no rules until you add some.',
  params: z.object({}),
  commands: (_p, ctx) =>
    ctx.pkg === 'dnf'
      ? [
          'echo "The firewall app supports ufw (Ubuntu and Debian) for now. Fedora and RHEL use firewalld." >&2; exit 1',
        ]
      : [DISTRO_GUARD, aptUpdate(ctx), apt(ctx, 'install ufw'), 'ufw --version'],
  risk: 'caution',
  riskReason: 'Installs a package with administrator rights.',
  longRunning: true,
  recordable: false,
  internal: true,
});

export const firewallEnable = defineAction({
  id: 'firewall.enable',
  title: 'Turn the firewall on',
  explain:
    'Turns ufw on: from now on, connections nobody has allowed are dropped. GFV first allows the SSH port, so you cannot lock yourself out by turning it on.',
  params: z.object({}),
  guard: ufwGuard,
  commands: (_p, ctx) => [
    NEEDS_UFW,
    `${ctx.sudo}ufw allow ${ctx.sshPort ?? 22}/tcp`,
    `${ctx.sudo}ufw --force enable`,
  ],
  risk: 'caution',
  riskReason: GUARDED_NOTE,
  recordable: false,
  internal: true,
});

export const firewallDisable = defineAction({
  id: 'firewall.disable',
  title: 'Turn the firewall off',
  explain:
    'Turns ufw off. Your rules are kept, but nothing is filtered until you turn it on again. Every port with a program behind it is then open to the internet.',
  params: z.object({}),
  guard: ufwGuard,
  commands: (_p, ctx) => [NEEDS_UFW, `${ctx.sudo}ufw --force disable`],
  risk: 'caution',
  riskReason: 'Without a firewall, every port a program listens on is reachable from the internet.',
  recordable: false,
  internal: true,
});

export const firewallAllow = defineAction({
  id: 'firewall.allow',
  title: 'Add a firewall rule',
  explain:
    'Adds a ufw rule. "allow" lets matching connections in, "deny" silently drops them, "limit" allows them but blocks an address that tries too often (good for SSH).',
  params: ruleSchema,
  guard: ufwGuard,
  // ufw checks rules top to bottom and the first match wins: a "deny" appended after "allow 22" would never apply,
  // so a deny goes to the top (insert 1). Two ufw quirks are handled: with no rules yet "insert 1" is refused, and
  // when the SAME match already exists as an allow, "insert" silently does nothing ("Skipping inserting existing
  // rule") while a plain "deny" flips that rule in place. Both fall back to the plain form.
  commands: (p, ctx) => {
    const m = ruleMatch(p);
    return [
      NEEDS_UFW,
      p.policy === 'deny'
        ? `out=$(${ctx.sudo}ufw insert 1 deny ${m} 2>&1); rc=$?; echo "$out"; case "$out" in *Skipping*) ${ctx.sudo}ufw deny ${m} ;; *) [ $rc -eq 0 ] || ${ctx.sudo}ufw deny ${m} ;; esac`
        : `${ctx.sudo}ufw ${p.policy} ${m}`,
    ];
  },
  dynamicRisk: (p, ctx) =>
    blocksSsh(p, ctx?.sshPort, ctx?.clientIp) ? { risk: 'danger', reason: LOCKOUT } : undefined,
  risk: 'caution',
  riskReason: GUARDED_NOTE,
  recordable: false,
  internal: true,
});

export const firewallDelete = defineAction({
  id: 'firewall.delete',
  title: 'Remove a firewall rule',
  explain:
    'Removes a ufw rule (and its IPv6 twin). Connections it allowed are then handled by the default, which is "deny" once the firewall is on.',
  params: ruleSchema,
  guard: ufwGuard,
  commands: (p, ctx) => [NEEDS_UFW, `${ctx.sudo}ufw delete ${p.policy} ${ruleMatch(p)}`],
  dynamicRisk: (p, ctx) =>
    removesSshAccess(p, ctx?.sshPort, ctx?.clientIp)
      ? {
          risk: 'danger',
          reason: `Removing "${describeRule(p)}" may take away the access GFV and you use to reach this server. The server undoes it by itself after 40 seconds if GFV can no longer connect.`,
        }
      : undefined,
  risk: 'caution',
  riskReason: GUARDED_NOTE,
  recordable: false,
  internal: true,
});

export const firewallRestore = defineAction({
  id: 'firewall.restore',
  title: 'Undo a firewall change',
  explain:
    'Puts the firewall back the way it was before an earlier change, using the copy GFV saved on the server. This is itself a guarded change (and saves the current rules first), so an undo can be undone too.',
  params: z.object({ backup: z.string().regex(GUARD_ID) }),
  guard: ufwGuard,
  commands: (p, ctx) => {
    const dir = `"$HOME/${GUARD_ROOT}/${p.backup}"`;
    return [
      `[ -d ${dir}/etc-ufw ] || { echo "That undo point does not exist (any more)." >&2; exit 1; }`,
      `DIR=${dir}; ${ufwGuard.restore(ctx).replace(/\n/g, '; ')}`,
    ];
  },
  risk: 'caution',
  riskReason: GUARDED_NOTE,
  recordable: false,
  internal: true,
});

export const firewallActions = [
  firewallStatus,
  firewallBackups,
  firewallInstall,
  firewallEnable,
  firewallDisable,
  firewallAllow,
  firewallDelete,
  firewallRestore,
];
