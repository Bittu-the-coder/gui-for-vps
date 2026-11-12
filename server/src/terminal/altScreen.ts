/**
 * Full-screen programs (vim, htop, less, nano) switch the terminal to the "alternate screen".
 * While one is running, keystrokes are for that program, not a shell prompt, so the danger
 * check must pause. We spot the switch in the OUTPUT stream.
 */
// eslint-disable-next-line no-control-regex -- matching the ESC byte is the point
const ALT = /\x1b\[\?(?:1049|1047|47)([hl])/g;
const MAX_SEQ = 8; // length of "\x1b[?1049h"

export class AltScreenDetector {
  active = false;
  private tail = '';

  /** Feed each chunk of terminal output; sequences split across chunks are handled. */
  feed(chunk: string): boolean {
    const text = this.tail + chunk;
    for (const m of text.matchAll(ALT)) this.active = m[1] === 'h';
    this.tail = text.slice(-(MAX_SEQ - 1));
    return this.active;
  }
}
