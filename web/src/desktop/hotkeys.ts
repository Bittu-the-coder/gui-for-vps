/**
 * Global shortcuts and where they must NOT fire.
 *
 *   Ctrl/Cmd+K   Spotlight        (Ctrl+K is left alone in the Terminal, where bash uses it to delete to
 *                                  the end of the line, and in the Editor, where it starts a chord;
 *                                  Cmd+K has no such meaning there, so it always works)
 *   Ctrl+Up      Mission Control  (not while typing, nor in the Terminal or Editor)
 */
export type Shortcut = 'spotlight' | 'overview' | null;

export interface KeyInfo {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
}
export interface FocusContext {
  inTerminal: boolean;
  inEditor: boolean;
  inTextField: boolean;
}

export function shortcutFor(e: KeyInfo, ctx: FocusContext): Shortcut {
  if (e.altKey || e.shiftKey) return null;
  const key = e.key.toLowerCase();
  if (key === 'k') {
    if (e.metaKey && !e.ctrlKey) return 'spotlight';
    if (e.ctrlKey && !e.metaKey && !ctx.inTerminal && !ctx.inEditor) return 'spotlight';
    return null;
  }
  if (e.key === 'ArrowUp' && e.ctrlKey && !e.metaKey) {
    return ctx.inTerminal || ctx.inEditor || ctx.inTextField ? null : 'overview';
  }
  return null;
}

/** Where is the keyboard focus right now? */
export function focusContext(target: EventTarget | null): FocusContext {
  const el = target instanceof Element ? target : null;
  return {
    inTerminal: !!el?.closest('.xterm'),
    inEditor: !!el?.closest('.monaco-editor'),
    inTextField: !!el?.closest('input, textarea, select, [contenteditable="true"]'),
  };
}
