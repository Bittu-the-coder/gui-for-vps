import { z } from 'zod';

/**
 * Pure helpers for the Database app. The real protection is on the database itself (every query runs inside
 * `BEGIN READ ONLY` unless a write was explicitly confirmed); this file only validates, classifies for the UI, and formats.
 */

export const connectionSchema = z.object({
  name: z.string().trim().min(1).max(60),
  /** Where the database listens, AS SEEN FROM THE SERVER (usually 127.0.0.1: GFV tunnels through SSH). */
  host: z
    .string()
    .trim()
    .min(1)
    .max(255)
    .regex(/^[A-Za-z0-9.-]+$/, 'A host name or address (letters, digits, dots, dashes)'),
  port: z.number().int().min(1).max(65535),
  database: z
    .string()
    .trim()
    .min(1)
    .max(63)
    .regex(/^[A-Za-z0-9_.$-]+$/, 'Letters, digits and _ . $ -'),
  user: z
    .string()
    .trim()
    .min(1)
    .max(63)
    .regex(/^[A-Za-z0-9_.$-]+$/, 'Letters, digits and _ . $ -'),
  password: z.string().max(512),
});
export type ConnectionInput = z.infer<typeof connectionSchema>;

/** A saved connection as the browser sees it: never the password. */
export const publicConnectionSchema = connectionSchema.omit({ password: true }).extend({
  id: z.string(),
  serverId: z.string(),
});
export type PublicConnection = z.infer<typeof publicConnectionSchema>;

/** Postgres identifier quoting: wrap in double quotes, double any embedded quote. Never string-concatenate a raw name. */
export function quoteIdent(name: string): string {
  if (name.includes('\0')) throw new Error('quoteIdent: NUL byte');
  return `"${name.replace(/"/g, '""')}"`;
}

/** Removes comments and the CONTENT of string literals / quoted identifiers, so keyword checks cannot be fooled by text. */
export function stripSql(sql: string): string {
  let out = '';
  let i = 0;
  while (i < sql.length) {
    const c = sql[i]!;
    const n = sql[i + 1];
    if (c === '-' && n === '-') {
      while (i < sql.length && sql[i] !== '\n') i++;
    } else if (c === '/' && n === '*') {
      let depth = 1;
      i += 2;
      while (i < sql.length && depth > 0) {
        if (sql[i] === '/' && sql[i + 1] === '*') {
          depth++;
          i += 2;
        } else if (sql[i] === '*' && sql[i + 1] === '/') {
          depth--;
          i += 2;
        } else i++;
      }
      out += ' ';
    } else if (c === "'" || c === '"') {
      const q = c;
      i++;
      while (i < sql.length) {
        if (sql[i] === q && sql[i + 1] === q) i += 2;
        else if (sql[i] === q) break;
        else i++;
      }
      i++;
      out += `${q}${q}`;
    } else if (c === '$') {
      // dollar-quoted string: $tag$ ... $tag$
      const m = /^\$[A-Za-z_]*\$/.exec(sql.slice(i));
      if (m) {
        const end = sql.indexOf(m[0], i + m[0].length);
        i = end === -1 ? sql.length : end + m[0].length;
        out += "''";
      } else {
        out += c;
        i++;
      }
    } else {
      out += c;
      i++;
    }
  }
  return out;
}

const WRITE_WORDS =
  /\b(insert|update|delete|drop|alter|create|truncate|grant|revoke|copy|merge|vacuum|reindex|cluster|comment|call|do|lock|refresh|reassign|security|set\s+role|set\s+session|discard|listen|notify|prepare|execute)\b/i;

/** For the UI only: does this look like it changes anything? (The database enforces read-only regardless.) */
export function classifySql(sql: string): 'empty' | 'read' | 'write' {
  const s = stripSql(sql).trim();
  if (!s) return 'empty';
  return WRITE_WORDS.test(s) ? 'write' : 'read';
}

export const QUERY_MAX_ROWS = 500;

/** One cell as text for the grid (null stays null). Objects and arrays become JSON, dates ISO strings. */
export function formatCell(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  if (typeof v === 'string') return v;
  if (typeof v === 'bigint') return v.toString();
  if (v instanceof Date) return v.toISOString();
  if (Buffer_isBuffer(v))
    return `\\x${[...(v as Uint8Array)].map((b) => b.toString(16).padStart(2, '0')).join('')}`;
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}
function Buffer_isBuffer(v: unknown): boolean {
  return v instanceof Uint8Array;
}

/** CSV (RFC 4180). A cell starting with = + - @ is prefixed with ' so a spreadsheet does not run it as a formula. */
export function toCsv(columns: string[], rows: (string | null)[][]): string {
  const cell = (v: string | null) => {
    if (v === null) return '';
    const safe = /^[=+\-@\t\r]/.test(v) ? `'${v}` : v;
    return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
  };
  return (
    [columns.map(cell).join(','), ...rows.map((r) => r.map(cell).join(','))].join('\r\n') + '\r\n'
  );
}

export interface DbTable {
  schema: string;
  name: string;
  kind: 'table' | 'view';
}
export interface DbColumn {
  name: string;
  type: string;
  nullable: boolean;
}
export interface QueryResult {
  columns: string[];
  rows: (string | null)[][];
  /** More rows existed than QUERY_MAX_ROWS. */
  truncated: boolean;
  /** For statements that return no rows: "INSERT 0 1", "UPDATE 3"... */
  command: string;
  rowCount: number | null;
  ms: number;
}
