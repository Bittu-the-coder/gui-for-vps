import type { MenuItem } from '../../components/menu/menuItems';
import { useDesktop } from '../../desktop/windowStore';
import { toast } from '../../stores/toastStore';

/**
 * Lets other parts of the UI (Learn panel, run preview) put a command into a terminal
 * WITHOUT running it: "Try it yourself". The user reads it and presses Enter themselves.
 * Terminals register while mounted; if none is open for the server we open one and
 * deliver the text once its shell is ready.
 */
export interface TerminalHandle {
  serverId: string;
  windowId: string;
  /** Is this the visible tab of its window? */
  isActive: () => boolean;
  /** Shell connected and accepting input. */
  live: boolean;
  paste: (text: string) => void;
  /** The text selected in the terminal ('' if none). */
  getSelection: () => string;
  selectAll: () => void;
  clear: () => void;
  focus: () => void;
}

const handles = new Set<TerminalHandle>();
let pending: { serverId: string; text: string } | null = null;

export function registerTerminal(h: TerminalHandle): () => void {
  handles.add(h);
  return () => {
    handles.delete(h);
  };
}

/** A terminal's shell just became ready: deliver text that was waiting for it. */
export function terminalReady(h: TerminalHandle): void {
  if (pending && pending.serverId === h.serverId) {
    const { text } = pending;
    pending = null;
    deliver(h, text);
  }
}

function deliver(h: TerminalHandle, text: string) {
  useDesktop.getState().focus(h.windowId); // also un-minimizes
  h.paste(text);
}

export function typeIntoTerminal(serverId: string, command: string): void {
  // One line only: a newline would run the command, which is exactly what we must not do.
  const text = command.replace(/\s*[\r\n]+\s*/g, ' ').trim();
  if (!text) return;
  const live = [...handles].filter((h) => h.serverId === serverId && h.live && h.isActive());
  const focused = useDesktop.getState().focusedId;
  const target = live.find((h) => h.windowId === focused) ?? live.at(-1);
  if (target) return deliver(target, text);
  pending = { serverId, text };
  useDesktop.getState().open({ appId: 'terminal', title: 'Terminal', w: 760, h: 460, serverId });
}

/** The visible tab's terminal in a window (what menus act on). */
export function terminalFor(windowId: string): TerminalHandle | undefined {
  return [...handles].find((h) => h.windowId === windowId && h.isActive());
}

/**
 * Copy / Paste / Select All / Clear for a terminal window: used by the Edit menu and the right-click menu,
 * so both always agree. Built when a menu opens, so "Copy" is disabled exactly when nothing is selected.
 */
export function terminalEditItems(windowId: string): MenuItem[] {
  const h = terminalFor(windowId);
  const selected = h?.getSelection() ?? '';
  return [
    {
      label: 'Copy',
      shortcut: 'Ctrl+Shift+C',
      disabled: !selected,
      onSelect: () => {
        void navigator.clipboard?.writeText(selected).catch(() => {});
        h?.focus();
      },
    },
    {
      label: 'Paste',
      disabled: !h?.live,
      onSelect: () => {
        navigator.clipboard
          ?.readText()
          .then((text) => text && h?.paste(text))
          .catch(() =>
            toast({
              kind: 'error',
              title: 'Could not read the clipboard',
              body: 'Try Ctrl+Shift+V.',
            }),
          );
      },
    },
    { label: 'Select All', disabled: !h, onSelect: () => (h?.selectAll(), h?.focus()) },
    { type: 'separator' },
    { label: 'Clear Terminal', disabled: !h, onSelect: () => (h?.clear(), h?.focus()) },
  ];
}
