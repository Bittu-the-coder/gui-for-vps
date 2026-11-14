import { TermServerMsgSchema, type DangerMatch } from '@gfv/shared';
import { FitAddon } from '@xterm/addon-fit';
import { Terminal } from '@xterm/xterm';
import '@xterm/xterm/css/xterm.css';
import { useEffect, useRef, useState } from 'react';
import { Button } from '../../components/ui/button';
import { api } from '../../lib/api';
import { registerTerminal, terminalReady, type TerminalHandle } from './terminalBus';

type Phase =
  | { kind: 'connecting' }
  | { kind: 'live' }
  | { kind: 'ended'; code: number | null }
  | { kind: 'error'; code: 'not_connected' | 'shell_failed' | 'socket'; message: string };

interface DangerPrompt {
  command: string;
  matches: DangerMatch[];
}

/** One xterm.js terminal wired to one SSH shell over a WebSocket. */
export function TerminalView({
  serverId,
  windowId,
  active,
}: {
  serverId: string;
  windowId: string;
  active: boolean;
}) {
  const activeRef = useRef(active);
  activeRef.current = active;
  const host = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const [session, setSession] = useState(0); // bump to start a fresh shell
  const [phase, setPhase] = useState<Phase>({ kind: 'connecting' });
  const [danger, setDanger] = useState<DangerPrompt | null>(null);
  const [reconnectNote, setReconnectNote] = useState('');

  useEffect(() => {
    const el = host.current!;
    setPhase({ kind: 'connecting' });
    setDanger(null);

    const term = new Terminal({
      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
      fontSize: 13,
      cursorBlink: true,
      scrollback: 5000,
      theme: { background: '#0b1020', foreground: '#e2e8f0' },
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(el);
    termRef.current = term;
    // Lets "Try it yourself" put text into this terminal (see terminalBus).
    const handle: TerminalHandle = {
      serverId,
      windowId,
      live: false,
      isActive: () => activeRef.current,
      paste: (text) => {
        term.paste(text);
        term.focus();
      },
      getSelection: () => term.getSelection(),
      selectAll: () => term.selectAll(),
      clear: () => term.clear(),
      focus: () => term.focus(),
    };
    const unregister = registerTerminal(handle);
    const doFit = () => {
      // A hidden tab (display:none) has no size: fitting would collapse the terminal.
      if (el.clientWidth > 0 && el.clientHeight > 0) {
        try {
          fit.fit();
        } catch {
          /* not ready yet */
        }
      }
    };
    doFit();

    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(
      `${proto}//${location.host}/api/terminal/${serverId}?cols=${term.cols}&rows=${term.rows}`,
    );
    ws.binaryType = 'arraybuffer';
    wsRef.current = ws;
    const send = (data: string | Uint8Array<ArrayBuffer>) =>
      ws.readyState === WebSocket.OPEN && ws.send(data);
    const enc = new TextEncoder();

    ws.onmessage = (e) => {
      if (typeof e.data !== 'string') return term.write(new Uint8Array(e.data as ArrayBuffer));
      let msg;
      try {
        msg = TermServerMsgSchema.safeParse(JSON.parse(e.data));
      } catch {
        return;
      }
      if (!msg.success) return;
      const m = msg.data;
      if (m.type === 'ready') {
        setPhase({ kind: 'live' });
        handle.live = true;
        terminalReady(handle);
        if (activeRef.current) term.focus();
      } else if (m.type === 'exit') setPhase({ kind: 'ended', code: m.code });
      else if (m.type === 'error') setPhase({ kind: 'error', code: m.code, message: m.message });
      else if (m.type === 'danger') setDanger({ command: m.command, matches: m.matches });
    };
    // If the socket drops without a clear message (server restarted, network), say so.
    ws.onclose = () => {
      handle.live = false;
      setPhase((p) =>
        p.kind === 'connecting' || p.kind === 'live'
          ? { kind: 'error', code: 'socket', message: 'The connection to GFV was lost.' }
          : p,
      );
    };

    term.onData((d) => send(enc.encode(d)));
    term.onBinary((d) => send(Uint8Array.from(d, (c) => c.charCodeAt(0))));
    term.onResize(({ cols, rows }) => send(JSON.stringify({ type: 'resize', cols, rows })));

    // Ctrl+Shift+C copies (plain Ctrl+C must stay SIGINT). Pasting is handled by xterm itself.
    term.attachCustomKeyEventHandler((e) => {
      if (e.type === 'keydown' && e.ctrlKey && e.shiftKey && e.code === 'KeyC') {
        e.preventDefault(); // otherwise the browser opens DevTools
        const sel = term.getSelection();
        if (sel) navigator.clipboard?.writeText(sel).catch(() => {});
        return false;
      }
      return true;
    });

    const ro = new ResizeObserver(doFit);
    ro.observe(el);

    return () => {
      unregister();
      ro.disconnect();
      ws.onclose = null;
      ws.close();
      term.dispose();
      termRef.current = null;
      wsRef.current = null;
    };
    // `active` is read only for the initial focus; tab switches are handled below.
  }, [serverId, session]);

  // Switching to this tab: focus it (the ResizeObserver refits once it becomes visible).
  useEffect(() => {
    if (active) termRef.current?.focus();
  }, [active]);

  const decide = (action: 'run' | 'cancel') => {
    wsRef.current?.send(JSON.stringify({ type: 'danger_decision', action }));
    setDanger(null);
    termRef.current?.focus();
  };

  const reconnect = async () => {
    setReconnectNote('Connecting…');
    try {
      const r = await api.connect(serverId);
      if (r.status === 'connected') {
        setReconnectNote('');
        setSession((n) => n + 1);
      } else {
        setReconnectNote(
          r.status === 'host_key_unknown' || r.status === 'host_key_changed'
            ? 'The host key needs your approval: open the Servers app and press Connect.'
            : r.status === 'auth_failed'
              ? 'Authentication failed. Check the server in the Servers app.'
              : r.status === 'error'
                ? `Could not connect: ${r.message}`
                : '',
        );
      }
    } catch {
      setReconnectNote('Could not reach the GFV server.');
    }
  };

  const level = danger?.matches.some((m) => m.level === 'danger') ? 'danger' : 'caution';
  const overlay =
    phase.kind === 'ended'
      ? {
          text: `Session ended${phase.code ? ` (exit code ${phase.code})` : ''}.`,
          action: 'Start new session',
          run: () => setSession((n) => n + 1),
        }
      : phase.kind === 'error'
        ? {
            text: phase.message,
            action: phase.code === 'shell_failed' ? 'Try again' : 'Reconnect',
            run: phase.code === 'shell_failed' ? () => setSession((n) => n + 1) : reconnect,
          }
        : null;

  return (
    <div className="relative h-full w-full bg-[#0b1020] p-2">
      <div ref={host} className="h-full w-full" />

      {danger && (
        <div
          role="alertdialog"
          aria-label="Dangerous command"
          className={`absolute inset-x-2 top-2 z-10 rounded-md border p-3 text-sm shadow-lg ${
            level === 'danger'
              ? 'border-red-500 bg-red-950/95 text-red-50'
              : 'border-amber-500 bg-amber-950/95 text-amber-50'
          }`}
          onKeyDown={(e) => e.key === 'Escape' && decide('cancel')}
        >
          <p className="font-semibold">
            {level === 'danger'
              ? '⛔ This command can seriously damage the server'
              : '⚠️ Double-check this command'}
          </p>
          <code className="my-2 block max-h-16 overflow-auto whitespace-pre-wrap break-all rounded bg-black/40 p-2 text-xs">
            {danger.command}
          </code>
          <ul className="mb-3 flex flex-col gap-1 text-xs">
            {danger.matches.map((m) => (
              <li key={m.id}>
                • {m.reason}
                {m.safer && <span className="block pl-3 opacity-80">Safer: {m.safer}</span>}
              </li>
            ))}
          </ul>
          <div className="flex justify-end gap-2">
            {/* Cancel has focus by default, so a stray Enter never runs the command. */}
            <Button autoFocus size="sm" variant="secondary" onClick={() => decide('cancel')}>
              Cancel
            </Button>
            <Button size="sm" variant="destructive" onClick={() => decide('run')}>
              Run anyway
            </Button>
          </div>
        </div>
      )}

      {overlay && (
        <div className="absolute inset-0 z-20 grid place-items-center bg-black/70 text-slate-100">
          <div className="flex max-w-xs flex-col items-center gap-3 text-center text-sm">
            <p>{overlay.text}</p>
            <Button size="sm" onClick={overlay.run}>
              {overlay.action}
            </Button>
            {reconnectNote && <p className="text-xs text-slate-300">{reconnectNote}</p>}
          </div>
        </div>
      )}
    </div>
  );
}
