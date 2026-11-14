import { z } from 'zod';

/**
 * Projects: an app deployed from a git repository onto a server. Everything GFV needs to remember lives on the
 * SERVER (a folder per project with a small metadata file), so there is no GFV database for it and a project is
 * visible from any GFV that connects to that machine.
 */

export const projectName = z
  .string()
  .regex(
    /^[a-z0-9][a-z0-9-]{0,40}$/,
    'lower-case letters, digits and hyphens, starting with a letter or digit',
  );

/** An https/ssh git URL, or a path to a repository on the same server. Never something git could read as an option. */
export const repoUrl = z
  .string()
  .max(500)
  .regex(
    /^(https:\/\/[A-Za-z0-9._~:/@%+-]+|ssh:\/\/[A-Za-z0-9._~:/@%+-]+|git@[A-Za-z0-9._-]+:[A-Za-z0-9._~/%+-]+|\/[A-Za-z0-9._/-]+)$/,
    'an https:// or ssh:// git URL, git@host:path, or an absolute path on the server',
  )
  .refine((u) => !u.includes('..'), 'no ".." in the address');

export const branchName = z
  .string()
  .max(100)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._/-]*$/, 'a branch name like main or release/1.2');

/** A command the person wants run (build, start). It is their own code: GFV only guarantees it is passed as ONE quoted argument. */
const oneLine = (c: string) => !c.includes('\0') && !c.includes('\n') && !c.includes('\r');
export const userCommand = z.string().max(1000).refine(oneLine, 'one line, please');
/** The same, but it must not be empty (a service needs something to run). */
export const requiredUserCommand = z
  .string()
  .min(1, 'required')
  .max(1000)
  .refine(oneLine, 'one line, please');

export const envKey = z
  .string()
  .regex(/^[A-Za-z_][A-Za-z0-9_]{0,63}$/, 'letters, digits and _, not starting with a digit');

export const PROJECTS_DIR = 'gfv-projects';
/** The service name for a project. */
export const unitName = (name: string) => `gfv-${name}.service`;

export interface ProjectMeta {
  name: string;
  repo: string;
  branch: string;
  build?: string;
  start?: string;
}

// --- systemd unit ------------------------------------------------------------------------------------

/**
 * Quote one argument for a systemd unit file: double quotes, with \ and " escaped, and % and $ doubled (systemd
 * expands both in ExecStart). Newlines are not allowed (validated earlier).
 */
export const systemdQuote = (s: string) =>
  `"${s
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/%/g, '%%')
    .replace(/\$/g, '$$$$')
    // A newline is written as the two characters \n: a value can never start a new line (a new directive).
    .replace(/\r/g, '\\r')
    .replace(/\n/g, '\\n')}"`;

/** The unit file that runs a project. `home` is the SSH user's home, `user` the account to run as (never root by default). */
export function renderUnit(p: { name: string; start: string; home: string; user: string }): string {
  const dir = `${p.home}/${PROJECTS_DIR}/${p.name}`;
  return [
    '# Managed by GFV.',
    '[Unit]',
    `Description=GFV project ${p.name}`,
    'After=network.target',
    '',
    '[Service]',
    `User=${p.user}`,
    `WorkingDirectory=${dir}`,
    `EnvironmentFile=-${dir}/.env`,
    `ExecStart=/bin/bash -lc ${systemdQuote(p.start)}`,
    'Restart=on-failure',
    'RestartSec=3',
    '',
    '[Install]',
    'WantedBy=multi-user.target',
    '',
  ].join('\n');
}

// --- environment file --------------------------------------------------------------------------------

/**
 * The text of a project's .env file in the format systemd's EnvironmentFile (and most dotenv readers) accept:
 * KEY="value" with \ and " escaped. Values may not contain newlines (they would break the format).
 */
export function renderEnvFile(
  vars: Record<string, string>,
): { ok: true; text: string } | { ok: false; error: string } {
  const lines: string[] = [];
  for (const [k, v] of Object.entries(vars)) {
    if (!envKey.safeParse(k).success)
      return { ok: false, error: `"${k}" is not a valid variable name.` };
    if (/[\r\n\0]/.test(v))
      return {
        ok: false,
        error: `The value of ${k} has a line break or a null byte, which this format cannot hold.`,
      };
    lines.push(`${k}="${v.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`);
  }
  return { ok: true, text: lines.join('\n') + (lines.length ? '\n' : '') };
}

/** Parse a .env text back into names only (values are never shown after saving). */
export function envKeys(text: string): string[] {
  return [...text.matchAll(/^([A-Za-z_][A-Za-z0-9_]*)=/gm)].map((m) => m[1]!);
}

// --- list output -------------------------------------------------------------------------------------

export interface ProjectInfo extends ProjectMeta {
  head?: string;
  active: 'active' | 'inactive' | 'failed' | 'unknown';
  hasEnv: boolean;
  /** Commits on the remote that are not deployed yet (after the last fetch); undefined if unknown. */
  behind?: number;
  hasUnit: boolean;
}

/** `==PROJECT:name` blocks with META:/HEAD:/ACTIVE:/ENV:/BEHIND:/UNIT: lines (see the list command). */
export function parseProjects(text: string): ProjectInfo[] {
  const out: ProjectInfo[] = [];
  let cur: Partial<ProjectInfo> | null = null;
  const flush = () => {
    if (cur?.name)
      out.push({
        active: 'unknown',
        hasEnv: false,
        hasUnit: false,
        repo: '',
        branch: 'main',
        ...cur,
      } as ProjectInfo);
    cur = null;
  };
  for (const line of text.split('\n')) {
    const m = /^==PROJECT:(.+)$/.exec(line);
    if (m) {
      flush();
      cur = { name: m[1]! };
      continue;
    }
    if (!cur) continue;
    const [k, ...rest] = line.split(':');
    const v = rest.join(':').trim();
    if (k === 'META') {
      try {
        const j = JSON.parse(v) as Partial<ProjectMeta>;
        cur = {
          ...cur,
          repo: j.repo ?? '',
          branch: j.branch ?? 'main',
          ...(j.build ? { build: j.build } : {}),
          ...(j.start ? { start: j.start } : {}),
        };
      } catch {
        /* a hand-edited file: show what we can */
      }
    } else if (k === 'HEAD' && v) cur.head = v;
    else if (k === 'ACTIVE')
      cur.active =
        v === 'active'
          ? 'active'
          : v === 'failed'
            ? 'failed'
            : v === 'inactive'
              ? 'inactive'
              : 'unknown';
    else if (k === 'ENV') cur.hasEnv = v === 'yes';
    else if (k === 'UNIT') cur.hasUnit = v === 'yes';
    else if (k === 'BEHIND' && /^\d+$/.test(v)) cur.behind = Number(v);
  }
  flush();
  return out;
}
