/**
 * Removes things that must never leave this computer from text that is about to be sent to a language model:
 * private keys, passwords and tokens, in the shapes they usually appear in shell output, config files and env files.
 * It errs on the side of removing too much. The person always sees the scrubbed text BEFORE it is sent.
 */
const RULES: [RegExp, string | ((m: string, ...g: string[]) => string)][] = [
  [
    /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z ]*PRIVATE KEY-----|$)/g,
    '[private key removed]',
  ],
  // Authorization headers first (the generic rule below would eat the word "Bearer" and leave the token).
  [/\b(authorization\s*:\s*(?:bearer|basic|token)\s+)[^\s'"]+/gi, '$1[removed]'],
  // KEY=value / key: value where the name looks secret.
  [
    /\b([A-Za-z0-9_.-]*(?:password|passwd|pwd|secret|token|api[_-]?key|apikey|credential|private[_-]?key|auth)[A-Za-z0-9_.-]*)(\s*[=:]\s*)(?:"[^"\n]*"|'[^'\n]*'|[^\s"',;]+)/gi,
    (_m, name: string, sep: string) => `${name}${sep}[removed]`,
  ],
  // --password foo / -p'foo' style flags.
  [
    /(--?(?:password|passwd|pass|token|secret|api-key)(?:=|\s+))(?:"[^"\n]*"|'[^'\n]*'|\S+)/gi,
    '$1[removed]',
  ],
  // Authorization headers and URLs with credentials.
  [/\b([a-z][a-z0-9+.-]*:\/\/)[^\s/:@]+:[^\s/@]+@/gi, '$1[removed]@'],
  // Well-known token shapes.
  [
    /\b(?:sk-ant-[A-Za-z0-9_-]{10,}|sk-[A-Za-z0-9_-]{20,}|gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|xox[abprs]-[A-Za-z0-9-]{10,}|AKIA[0-9A-Z]{16}|AIza[0-9A-Za-z_-]{30,})\b/g,
    '[token removed]',
  ],
  // JWTs.
  [/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g, '[token removed]'],
];

export function scrubSecrets(text: string): string {
  let out = text;
  for (const [re, rep] of RULES) out = out.replace(re, rep as string);
  return out;
}

/** True when scrubbing changed anything (the preview says so). */
export const hadSecrets = (text: string): boolean => scrubSecrets(text) !== text;
