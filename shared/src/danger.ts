import { z } from 'zod';

/**
 * Danger-pattern detector (Safety Net). Pure function, shared by the Terminal (checks what
 * you type) and the Command Runner (checks the commands an Action would run).
 *
 * It is a safety net for ACCIDENTS, not a security boundary: shell syntax is too rich to
 * parse perfectly (aliases, variables, eval, scripts). It aims to catch the common ways a
 * beginner wrecks a server, with few false alarms.
 */

export const DangerMatchSchema = z.object({
  id: z.string(),
  level: z.enum(['caution', 'danger']),
  reason: z.string(),
  /** A safer way to get the same result, when there is one. */
  safer: z.string().optional(),
});
export type DangerMatch = z.infer<typeof DangerMatchSchema>;

type Draft = Omit<DangerMatch, 'id'>;

// Commands that run another command: `sudo -u bob rm -rf /` really runs `rm`.
const WRAPPERS = new Set([
  'sudo',
  'doas',
  'time',
  'nohup',
  'exec',
  'command',
  'nice',
  'ionice',
  'env',
]);

// Paths where a recursive delete / chmod / chown is catastrophic.
const CRITICAL_PATHS = new Set(
  ['', '/*', '~', '~/*', '$HOME', '$HOME/*', '${HOME}', '${HOME}/*']
    .concat(
      [
        'etc',
        'usr',
        'var',
        'boot',
        'bin',
        'sbin',
        'lib',
        'lib64',
        'home',
        'root',
        'opt',
        'srv',
        'dev',
      ].flatMap((d) => [`/${d}`, `/${d}/*`]),
    )
    .map((p) => (p === '' ? '/' : p)),
);

const READONLY_CMDS = new Set([
  'cat',
  'grep',
  'egrep',
  'less',
  'more',
  'head',
  'tail',
  'ls',
  'diff',
  'stat',
  'file',
  'wc',
  'sshd',
  'visudo-check',
  'bat',
]);
const CRITICAL_CONFIG = /(^|\/)(sshd_config(\.d\/.*)?|sudoers(\.d\/.*)?|fstab)$/;

/** Is this a file whose breakage can lock you out or stop the server booting? (sshd_config, sudoers, fstab) */
export const isCriticalConfigPath = (path: string): boolean => CRITICAL_CONFIG.test(path);

const base = (t: string) => t.split('/').pop() ?? t;
const normPath = (t: string) => (/^\/+$/.test(t) ? '/' : t.replace(/\/+$/, ''));

function tokenize(segment: string): string[] {
  return segment
    .trim()
    .split(/\s+/)
    .map((t) => t.replace(/^['"]+|['"]+$/g, ''))
    .filter(Boolean);
}

/** Find the real command in a segment, skipping env assignments and wrappers like sudo. */
function commandOf(tokens: string[]): { name: string; args: string[] } | undefined {
  let i = 0;
  while (i < tokens.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(tokens[i]!)) i++;
  if (i >= tokens.length) return undefined;
  if (WRAPPERS.has(base(tokens[i]!))) {
    i++;
    // skip wrapper options (and their values, e.g. `sudo -u bob`) up to the first thing
    // that looks like a command name rather than an option
    while (i < tokens.length && tokens[i]!.startsWith('-')) {
      i += tokens[i] === '-u' || tokens[i] === '-g' || tokens[i] === '-n' ? 2 : 1;
    }
  }
  if (i >= tokens.length) return undefined;
  return { name: base(tokens[i]!), args: tokens.slice(i + 1) };
}

function splitArgs(args: string[]) {
  const flags: string[] = [];
  const targets: string[] = [];
  let endOfFlags = false;
  for (const a of args) {
    if (!endOfFlags && a === '--') endOfFlags = true;
    else if (!endOfFlags && a.startsWith('-') && a.length > 1) flags.push(a);
    else targets.push(a);
  }
  const letters = flags
    .filter((f) => !f.startsWith('--'))
    .join('')
    .replace(/-/g, '');
  const longs = flags.filter((f) => f.startsWith('--'));
  return { flags, letters, longs, targets };
}

function checkSegment(tokens: string[], out: Map<string, Draft>) {
  const cmd = commandOf(tokens);
  if (!cmd) return;
  const { args } = cmd;
  // mkfs.ext4, mkfs.xfs, ... are all `mkfs`
  const name = /^mkfs\.\w+$/.test(cmd.name) ? 'mkfs' : cmd.name;
  const { letters, longs, targets } = splitArgs(args);
  const add = (id: string, d: Draft) => out.has(id) || out.set(id, d);

  switch (name) {
    case 'rm': {
      const recursive = /[rR]/.test(letters) || longs.includes('--recursive');
      if (!recursive) break;
      if (targets.some((t) => CRITICAL_PATHS.has(normPath(t)))) {
        add('rm-critical', {
          level: 'danger',
          reason: 'Recursively deletes a system or home directory. This can destroy the server.',
          safer: 'Delete a specific folder instead, e.g. rm -rf ./old-build',
        });
      } else if (targets.some((t) => t === '*' || t === '.' || t === './*')) {
        add('rm-wildcard', {
          level: 'caution',
          reason: 'Deletes everything in the current directory. Check with pwd and ls first.',
          safer: 'Run ls first to see what will be removed.',
        });
      }
      break;
    }
    case 'chmod': {
      const wideOpen = targets.some((t) => /^0?777$|^(a|ugo)\+rwx$/.test(t));
      if (!wideOpen) break;
      const recursive = /R/.test(letters) || longs.includes('--recursive');
      if (recursive && targets.some((t) => CRITICAL_PATHS.has(normPath(t)))) {
        add('chmod-critical', {
          level: 'danger',
          reason:
            'Makes system files writable by everyone, which can break the server and its security.',
        });
      } else {
        add('chmod-777', {
          level: 'caution',
          reason:
            'Lets every user on the server read, change and run this. It is almost never needed.',
          safer: 'Use 755 for programs/folders or 644 for regular files.',
        });
      }
      break;
    }
    case 'chown':
    case 'chgrp':
      if (/R/.test(letters) && targets.some((t) => CRITICAL_PATHS.has(normPath(t)))) {
        add('chown-critical', {
          level: 'danger',
          reason:
            'Changes ownership of system files recursively, which can break the whole server.',
        });
      }
      break;
    case 'dd':
      if (args.some((a) => /^of=\/dev\/(sd|nvme|vd|xvd|hd|mmcblk)/.test(a))) {
        add('dd-device', {
          level: 'danger',
          reason: 'Writes raw data over a disk. Everything on that disk will be lost.',
        });
      }
      break;
    case 'mkfs':
    case 'mke2fs':
    case 'wipefs':
      add('format-disk', {
        level: 'danger',
        reason: 'Formats or wipes a disk. All data on it will be lost.',
      });
      break;
    case 'shred':
      if (targets.some((t) => t.startsWith('/dev/')))
        add('format-disk', { level: 'danger', reason: 'Destroys the data on a disk device.' });
      break;
    case 'fdisk':
    case 'parted':
    case 'gdisk':
    case 'cfdisk':
      add('partition', {
        level: 'caution',
        reason: 'Edits disk partitions. A mistake can make the server unbootable.',
      });
      break;
    case 'ufw':
      if (targets.includes('disable') || targets.includes('reset')) {
        add('ufw-off', {
          level: 'danger',
          reason:
            'Turns off or resets the firewall, exposing every service on the server to the internet.',
          safer: 'Use `ufw delete allow <port>` to remove just one rule.',
        });
      }
      break;
    case 'iptables':
    case 'ip6tables':
    case 'nft':
      if (args.includes('-F') || args.includes('--flush') || targets.includes('flush')) {
        add('firewall-flush', {
          level: 'caution',
          reason:
            'Flushes all firewall rules, which can open the server up (or cut your SSH session).',
        });
      }
      break;
    case 'kill':
      if (targets.includes('1')) {
        add('kill-init', {
          level: 'danger',
          reason: 'PID 1 is the init system. Killing it can crash or hang the server.',
        });
      }
      break;
    case 'pkill':
    case 'killall':
      if (targets.some((t) => /^(sshd?|systemd|init)$/.test(t))) {
        add('kill-sshd', {
          level: 'danger',
          reason: 'Stops SSH (or the init system). You would be locked out of the server.',
        });
      }
      break;
    case 'systemctl':
    case 'service': {
      const all = args.join(' ');
      if (/\b(stop|disable|mask)\b/.test(all) && /\bsshd?(\.service|\.socket)?\b/.test(all)) {
        add('stop-sshd', {
          level: 'danger',
          reason: 'Stopping SSH locks you out of the server. GFV itself connects over SSH.',
        });
      } else if (/\brestart\b/.test(all) && /\bsshd?(\.service)?\b/.test(all)) {
        add('restart-sshd', {
          level: 'caution',
          reason: 'If sshd_config has an error, SSH will not come back and you will be locked out.',
          safer:
            'Run `sshd -t` first to validate the config, and keep this session open until you test a new login.',
        });
      } else if (/\b(poweroff|reboot|halt)\b/.test(all)) {
        add('power', {
          level: 'caution',
          reason: 'Takes the server offline. It will be unreachable until it comes back up.',
        });
      }
      break;
    }
    case 'shutdown':
    case 'reboot':
    case 'halt':
    case 'poweroff':
      add('power', {
        level: 'caution',
        reason: 'Takes the server offline. It will be unreachable until it comes back up.',
      });
      break;
    case 'init':
    case 'telinit':
      if (targets.some((t) => t === '0' || t === '6'))
        add('power', { level: 'caution', reason: 'Takes the server offline.' });
      break;
    case 'visudo':
      add('critical-config', {
        level: 'caution',
        reason: 'A broken sudoers file can remove your ability to use sudo.',
        safer: 'visudo validates the file before saving, so use it (and keep a root session open).',
      });
      break;
  }

  // Editing/overwriting critical config files, unless the command only reads them.
  if (
    !READONLY_CMDS.has(name) &&
    name !== 'visudo' &&
    tokens.some((t) => CRITICAL_CONFIG.test(t))
  ) {
    add('critical-config', {
      level: 'caution',
      reason:
        'A mistake in this file (sshd_config, sudoers, fstab) can lock you out or stop the server booting.',
      safer:
        'Make a backup first, validate before reloading (e.g. sshd -t), and keep a second session open.',
    });
  }
}

/** Returns every danger found in a command line (empty array = nothing suspicious). Danger sorts first. */
export function detectDanger(commandLine: string): DangerMatch[] {
  const out = new Map<string, Draft>();
  const add = (id: string, d: Draft) => out.has(id) || out.set(id, d);

  // Whole-line patterns (they span pipes, redirects and braces).
  if (/:\s*\(\s*\)\s*\{[^}]*:\s*\|\s*:\s*&/.test(commandLine)) {
    add('fork-bomb', {
      level: 'danger',
      reason: 'A fork bomb: it spawns processes until the server freezes.',
    });
  }
  if (/\b(curl|wget)\b[^|;&\n]*\|\s*(sudo\s+(-\w+\s+)*)?(ba|z|da|k)?sh\b/.test(commandLine)) {
    add('pipe-to-shell', {
      level: 'caution',
      reason: 'Runs a script from the internet without you reading it first.',
      safer: 'Download it (curl -O ...), read it, then run it.',
    });
  }
  if (/(?<![>&\d])>\s*\/dev\/(sd|nvme|vd|xvd|hd)/.test(commandLine)) {
    add('overwrite-disk', {
      level: 'danger',
      reason: 'Redirects output onto a raw disk device, destroying its data.',
    });
  }
  if (/(?<![>&\d])>{1,2}\s*\/(etc|boot|usr|bin|sbin|lib|lib64)\//.test(commandLine)) {
    add('overwrite-system-file', {
      level: 'caution',
      reason: 'Overwrites or appends to a system file. `>` replaces the whole file.',
      safer: 'Back the file up first (cp file file.bak) and use `>>` only if you mean to append.',
    });
  }
  if (/\bkill\b[^;&|\n]*\b(pidof|pgrep)\b[^;&|\n]*\bsshd?\b/.test(commandLine)) {
    add('kill-sshd', {
      level: 'danger',
      reason: 'Stops SSH. You would be locked out of the server.',
    });
  }

  // Per-command checks. Treat ; && || | newline and subshell/backtick delimiters as boundaries.
  const segments = commandLine.replace(/\$\(|[`()]/g, ';').split(/&&|\|\||\||;|\n/);
  for (const seg of segments) {
    const tokens = tokenize(seg);
    if (tokens.length) checkSegment(tokens, out);
  }

  return [...out.entries()]
    .map(([id, d]) => ({ id, ...d }))
    .sort((a, b) => (a.level === b.level ? 0 : a.level === 'danger' ? -1 : 1));
}

export function worstLevel(matches: DangerMatch[]): 'safe' | 'caution' | 'danger' {
  return matches.some((m) => m.level === 'danger') ? 'danger' : matches.length ? 'caution' : 'safe';
}
