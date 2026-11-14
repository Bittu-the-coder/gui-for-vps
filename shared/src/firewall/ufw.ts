import { z } from 'zod';

/** Pure helpers for the firewall (ufw): rule validation, the ufw words for a rule, parsing, and lockout checks. */

const octet = '(?:25[0-5]|2[0-4]\\d|1?\\d?\\d)';
const IPV4 = new RegExp(`^${octet}(?:\\.${octet}){3}(?:/(?:3[0-2]|[12]?\\d))?$`);

/** "80", or a range "8000:8100". Anything else (names, spaces, shell syntax) cannot get into a command. */
const portSchema = z
  .string()
  .regex(/^\d{1,5}(?::\d{1,5})?$/, 'Use a port number like 80, or a range like 8000:8100')
  .refine(
    (v) => v.split(':').every((n) => Number(n) >= 1 && Number(n) <= 65535),
    'Ports go from 1 to 65535',
  )
  .refine((v) => {
    const [a, b] = v.split(':');
    return b === undefined || Number(a) < Number(b);
  }, 'A range must go from the lower port to the higher one');

export const ruleSchema = z
  .object({
    policy: z.enum(['allow', 'deny', 'limit']),
    /** Absent = every port (only allowed together with a specific source address). */
    port: portSchema.optional(),
    proto: z.enum(['tcp', 'udp', 'any']).default('tcp'),
    /** "any" or an IPv4 address / network like 203.0.113.7 or 10.0.0.0/8. */
    from: z
      .string()
      .regex(/^(?:any|[0-9./]+)$/, 'Use "any" or an IPv4 address')
      .refine((v) => v === 'any' || IPV4.test(v), 'That is not a valid IPv4 address or network')
      .default('any'),
  })
  .refine((r) => r.port !== undefined || r.from !== 'any', {
    message: 'A rule for every port needs a specific source address',
    path: ['port'],
  })
  .refine((r) => !r.port?.includes(':') || r.proto !== 'any', {
    message: 'A port range needs tcp or udp',
    path: ['proto'],
  });
export type Rule = z.infer<typeof ruleSchema>;

/** The ufw words for the matching part of a rule: `from any to any port 22 proto tcp`. */
export function ruleMatch(r: Rule): string {
  return `from ${r.from} to any${r.port ? ` port ${r.port}` : ''}${r.proto !== 'any' ? ` proto ${r.proto}` : ''}`;
}

/** Plain-English summary shown in titles and the rules table. */
export function describeRule(r: Rule): string {
  const what = r.port
    ? `port ${r.port.replace(':', '–')}${r.proto !== 'any' ? `/${r.proto}` : ''}`
    : 'everything';
  const who = r.from === 'any' ? 'from anywhere' : `from ${r.from}`;
  return `${r.policy} ${what} ${who}`;
}

// ---- lockout checks ----------------------------------------------------------------------------------------------

function ipToInt(ip: string): number {
  return ip.split('.').reduce((n, o) => n * 256 + Number(o), 0);
}

/** Does `from` (any, an address or a network) include `ip`? Unknown ip: assume it could. */
export function fromCovers(from: string, ip?: string): boolean {
  if (from === 'any' || !ip) return true;
  const [net, bits = '32'] = from.split('/');
  const mask = Number(bits) === 0 ? 0 : (0xffffffff << (32 - Number(bits))) >>> 0;
  return (ipToInt(net!) & mask) >>> 0 === (ipToInt(ip) & mask) >>> 0;
}

function portCovers(port: string | undefined, target: number): boolean {
  if (!port) return true;
  const [a, b] = port.split(':').map(Number);
  return target >= a! && target <= (b ?? a!);
}

/** Would this rule match SSH traffic from GFV (the server's SSH port, from GFV's address)? */
export function matchesSsh(r: Rule, sshPort = 22, clientIp?: string): boolean {
  return portCovers(r.port, sshPort) && r.proto !== 'udp' && fromCovers(r.from, clientIp);
}

/** Adding this rule could lock GFV out (a deny that covers SSH). */
export const blocksSsh = (r: Rule, sshPort?: number, clientIp?: string) =>
  r.policy === 'deny' && matchesSsh(r, sshPort, clientIp);

/** Deleting this rule could lock GFV out (it is an allow that covers SSH). */
export const removesSshAccess = (r: Rule, sshPort?: number, clientIp?: string) =>
  r.policy !== 'deny' && matchesSsh(r, sshPort, clientIp);

// ---- parsing `ufw status verbose` ----------------------------------------------------------------------------------

export interface FirewallRule extends Rule {
  /** The rule as ufw printed it, for display. */
  to: string;
  v6: boolean;
}

export interface FirewallStatus {
  installed: boolean;
  active: boolean;
  defaultIncoming?: string;
  rules: FirewallRule[];
  /** ufw refused to answer (usually: not allowed to use sudo). */
  error?: string;
  /** The SSH port and address GFV uses, as the server sees them (for lockout warnings). */
  sshPort?: number;
  clientIp?: string;
}

/** Parses the output of the status command (`NO_UFW` when ufw is missing). Unknown lines are ignored. */
export function parseStatus(text: string): FirewallStatus {
  const conn = /^SSHCONN:(\S+) \S+ \S+ (\d+)/m.exec(text);
  const who = conn ? { sshPort: Number(conn[2]), clientIp: conn[1]! } : {};
  const status = parseUfw(text);
  return { ...status, ...who };
}

function parseUfw(text: string): FirewallStatus {
  if (/NO_UFW/.test(text)) return { installed: false, active: false, rules: [] };
  if (/ERROR|You need to be root|password is required/i.test(text) && !/^Status:/m.test(text))
    return {
      installed: true,
      active: false,
      rules: [],
      error: text.trim().split('\n')[0] ?? 'ufw did not answer',
    };
  const active = /^Status:\s*active/m.test(text);
  const def = /^Default:\s*(\w+) \(incoming\)/m.exec(text)?.[1];
  const rules: FirewallRule[] = [];
  const seenV4 = new Set<string>();
  const parsed: FirewallRule[] = [];
  let inTable = false;
  for (const line of text.split('\n')) {
    if (/^--\s+/.test(line)) {
      inTable = true;
      continue;
    }
    if (!inTable || !line.trim()) continue;
    const cols = line.trim().split(/\s{2,}/);
    if (cols.length < 3) continue;
    const [toRaw, actionRaw, fromRaw] = cols as [string, string, string];
    const am = /^(ALLOW|DENY|LIMIT|REJECT)\s+IN$/.exec(actionRaw);
    if (!am) continue; // outgoing / forwarding rules are not managed here
    const v6 = /\(v6\)/.test(toRaw) || /\(v6\)/.test(fromRaw);
    const to = toRaw.replace(/\s*\(v6\)/, '');
    const from = fromRaw.replace(/\s*\(v6\)/, '').replace(/^Anywhere$/, 'any');
    const pm = /^(\d{1,5}(?::\d{1,5})?)(?:\/(tcp|udp))?$/.exec(to);
    const rule: FirewallRule = {
      policy: am[1]!.toLowerCase() === 'reject' ? 'deny' : (am[1]!.toLowerCase() as Rule['policy']),
      ...(pm ? { port: pm[1]! } : {}),
      proto: (pm?.[2] as Rule['proto'] | undefined) ?? 'any',
      from: v6 ? from : /^[0-9./]+$/.test(from) || from === 'any' ? from : 'any',
      to: toRaw.replace(/\s*\(v6\)/, ''),
      v6,
    };
    parsed.push(rule);
    if (!v6) seenV4.add(`${rule.policy}|${rule.port}|${rule.proto}|${rule.from}`);
  }
  // ufw adds an IPv6 twin of every rule: show it once (a delete removes both).
  for (const r of parsed)
    if (!r.v6 || !seenV4.has(`${r.policy}|${r.port}|${r.proto}|${r.from}`)) rules.push(r);
  return { installed: true, active, ...(def ? { defaultIncoming: def } : {}), rules };
}

// ---- the undo list ---------------------------------------------------------------------------------------------------

export interface FirewallBackup {
  id: string;
  title: string;
  /** What was changed ("ufw", "sshd"); older points have none and are ufw. */
  kind: string;
  /** Seconds since 1970. */
  at: number;
  /** GFV confirmed it could still connect (the automatic undo was cancelled). */
  confirmed: boolean;
  /** The server undid the change by itself. */
  reverted: boolean;
}

/** Parses the output of the backups listing command. Newest first. */
export function parseBackups(text: string): FirewallBackup[] {
  const out: FirewallBackup[] = [];
  let cur: (FirewallBackup & { n: number }) | null = null;
  const push = () => {
    if (cur) {
      const { n: _n, ...rest } = cur;
      void _n;
      out.push(rest);
    }
  };
  for (const line of text.split('\n')) {
    const id = /^==BACKUP:(\S+)$/.exec(line)?.[1];
    if (id) {
      push();
      cur = { id, title: '', kind: 'ufw', at: 0, confirmed: false, reverted: false, n: 0 };
    } else if (cur && line === '==OK') cur.confirmed = true;
    else if (cur && line === '==REVERTED') cur.reverted = true;
    else if (cur && cur.n === 0) {
      cur.title = line;
      cur.n = 1;
    } else if (cur && cur.n === 1) {
      cur.at = Number(line) || 0;
      cur.n = 2;
    } else if (cur && cur.n === 2 && /^[a-z0-9-]+$/.test(line)) {
      cur.kind = line;
      cur.n = 3;
    }
  }
  push();
  return out.sort((a, b) => b.at - a.at);
}
