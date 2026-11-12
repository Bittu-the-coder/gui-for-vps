import { detectDanger, type DangerMatch } from '@gfv/shared';

export interface TrackResult {
  /** Input that is safe to send to the shell now. */
  forward: string;
  /** Set when an Enter would run a dangerous line: the Enter (and everything after) is withheld. */
  hold?: { line: string; matches: DangerMatch[]; rest: string };
}

type Esc = 'none' | 'esc' | 'csi' | 'ss3';

/**
 * Reconstructs the command line the user is typing from raw keystrokes, so the Safety Net
 * can check it when Enter is pressed. Best effort: Tab completion, history (arrows) and
 * cursor movement edit the line in ways only the shell can see, so we remember we are
 * `uncertain` and simply check what was typed. It never stores or logs input.
 */
export class LineTracker {
  private buffer = '';
  private esc: Esc = 'none';
  private csi = '';
  private inPaste = false;
  /** True if the shell may have changed the line behind our back. Informational. */
  uncertain = false;

  reset() {
    this.buffer = '';
    this.esc = 'none';
    this.csi = '';
    this.inPaste = false;
    this.uncertain = false;
  }

  process(input: string): TrackResult {
    for (let i = 0; i < input.length; i++) {
      const ch = input[i]!;

      if (this.esc !== 'none') {
        this.escapeChar(ch);
        continue;
      }
      if (ch === '\x1b') {
        this.esc = 'esc';
        continue;
      }

      if (this.inPaste) {
        // Bracketed paste: text is literal, newlines do NOT run anything.
        this.buffer += ch === '\r' ? '\n' : ch;
        continue;
      }

      if (ch === '\r' || ch === '\n') {
        const line = this.buffer;
        const matches = detectDanger(line);
        if (matches.length > 0) {
          // A CRLF pair is one Enter.
          const restFrom = ch === '\r' && input[i + 1] === '\n' ? i + 2 : i + 1;
          return {
            forward: input.slice(0, i),
            hold: { line, matches, rest: input.slice(restFrom) },
          };
        }
        this.buffer = '';
        this.uncertain = false;
        continue;
      }

      switch (ch) {
        case '\x7f':
        case '\b':
          this.buffer = [...this.buffer].slice(0, -1).join('');
          break;
        case '\x15': // Ctrl-U: kill line
        case '\x03': // Ctrl-C: abort line
          this.buffer = '';
          this.uncertain = false;
          break;
        case '\x17': // Ctrl-W: delete previous word
          this.buffer = this.buffer.replace(/\S*\s*$/, '');
          break;
        case '\t': // completion: the shell inserts text we cannot see
        case '\x12': // Ctrl-R: history search
        case '\x0b': // Ctrl-K
        case '\x19': // Ctrl-Y
        case '\x01': // Ctrl-A (cursor move)
        case '\x05': // Ctrl-E
          this.uncertain = true;
          break;
        default:
          if (ch >= ' ') this.buffer += ch; // printable (incl. non-ASCII)
      }
    }
    return { forward: input };
  }

  private escapeChar(ch: string) {
    if (this.esc === 'esc') {
      if (ch === '[') {
        this.esc = 'csi';
        this.csi = '';
      } else if (ch === 'O') {
        this.esc = 'ss3';
      } else {
        this.esc = 'none'; // Alt+key (word movement, etc.)
        this.uncertain = true;
      }
    } else if (this.esc === 'ss3') {
      this.esc = 'none'; // e.g. application-mode arrow keys: ESC O A
      this.uncertain = true;
    } else {
      // CSI: parameters until a final byte 0x40-0x7e
      if (ch >= '@' && ch <= '~') {
        const seq = this.csi + ch;
        this.esc = 'none';
        if (seq === '200~') this.inPaste = true;
        else if (seq === '201~') this.inPaste = false;
        else this.uncertain = true; // arrows, Home/End, Delete, ...
      } else {
        this.csi += ch;
      }
    }
  }
}
