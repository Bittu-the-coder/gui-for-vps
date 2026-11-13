// Commands that run another command: the interesting name is the one after them.
const WRAPPERS = new Set(['sudo', 'doas', 'time', 'nohup', 'exec', 'command', 'nice', 'env']);

// Shell syntax, not programs: "if [ -e f ]; then cat f; fi" teaches `cat`, not `if` / `then` / `fi`.
const SYNTAX = new Set([
  'if',
  'then',
  'else',
  'elif',
  'fi',
  'do',
  'done',
  'while',
  'until',
  'case',
  'esac',
  'for',
  'in',
  '!',
  '{',
  '}',
]);

/** Names of the programs a command line runs: "sudo apt-get clean && df -h /" -> ["apt-get", "df"]. */
export function commandNames(commandLine: string): string[] {
  const names: string[] = [];
  for (const seg of commandLine.split(/&&|\|\||\||;|\n/)) {
    const tokens = seg.trim().split(/\s+/).filter(Boolean);
    let i = 0;
    while (i < tokens.length) {
      const t = tokens[i]!;
      if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(t))
        i++; // FOO=bar prefix
      else if (WRAPPERS.has(t)) {
        i++;
        while (i < tokens.length && tokens[i]!.startsWith('-')) i++; // sudo -n
      } else if (t === 'exit' || t === 'return') {
        i = tokens.length; // builtins that take a status, not a command
      } else if (SYNTAX.has(t)) i++;
      else break;
    }
    const first = tokens[i];
    if (first && /^[A-Za-z0-9_./-]+$/.test(first)) names.push(first.split('/').pop()!);
  }
  return names;
}
