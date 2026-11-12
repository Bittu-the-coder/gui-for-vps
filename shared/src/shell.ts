/**
 * The ONLY way a value may enter a shell command string.
 * Wraps in single quotes (inside which the shell interprets nothing) and turns each
 * embedded ' into '\'' (close quote, escaped quote, reopen quote).
 * Plain safe words (paths, flags, names) are left unquoted so the commands stay readable.
 */
export function shellQuote(value: string): string {
  if (value.includes('\0')) throw new Error('shellQuote: NUL byte in value');
  if (value !== '' && /^[A-Za-z0-9_@%+=:,./-]+$/.test(value) && !value.startsWith('-')) {
    return value;
  }
  return `'${value.replace(/'/g, `'\\''`)}'`;
}
