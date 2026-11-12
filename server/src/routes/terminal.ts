import type { FastifyInstance } from 'fastify';
import type { ClientChannel } from 'ssh2';
import { TermClientMsgSchema, type TermServerMsg } from '@gfv/shared';
import type { AppContext } from '../context.js';
import { AltScreenDetector } from '../terminal/altScreen.js';
import { LineTracker } from '../terminal/lineTracker.js';
import { originAllowed } from './origin.js';

const clamp = (v: unknown, def: number, min: number, max: number) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, Math.floor(n))) : def;
};

// Backpressure: if the browser can't keep up (e.g. `cat hugefile`), pause the SSH stream.
const HIGH_WATER = 1 << 20;
const LOW_WATER = 1 << 18;

/**
 * Interactive terminal: one WebSocket <-> one SSH shell channel (PTY) on the pooled connection.
 * This is the one place that runs commands outside the Command
 * Runner, as CLAUDE.md allows for the raw PTY. Its input is still checked by the danger
 * detector. NEVER log terminal input or output: it can contain passwords.
 */
export function terminalRoutes(app: FastifyInstance, { pool, allowedOrigins }: AppContext): void {
  app.get<{ Params: { serverId: string }; Querystring: { cols?: string; rows?: string } }>(
    '/api/terminal/:serverId',
    { websocket: true },
    (socket, req) => {
      if (!originAllowed(req.headers.origin, allowedOrigins)) {
        socket.close(1008, 'origin not allowed');
        return;
      }
      const sendMsg = (m: TermServerMsg) => socket.send(JSON.stringify(m));

      const client = pool.getClient(req.params.serverId);
      if (!client) {
        sendMsg({ type: 'error', code: 'not_connected', message: 'This server is not connected.' });
        socket.close(1000, 'not connected');
        return;
      }

      // Listeners are attached NOW, not when the shell is ready: the browser may type (or send a
      // resize) the instant the socket opens, and those messages must not be lost.
      type Handler = (buf: Buffer, isBinary: boolean) => void;
      let handler: Handler | undefined;
      let closed = false;
      let onClose: (() => void) | undefined;
      const queue: { buf: Buffer; isBinary: boolean }[] = [];
      socket.on('message', (data: Buffer | ArrayBuffer | Buffer[], isBinary: boolean) => {
        const buf = Buffer.isBuffer(data)
          ? data
          : Array.isArray(data)
            ? Buffer.concat(data)
            : Buffer.from(data);
        if (handler) handler(buf, isBinary);
        else queue.push({ buf, isBinary });
      });
      socket.on('close', () => {
        closed = true;
        onClose?.();
      });

      const cols = clamp(req.query.cols, 80, 1, 500);
      const rows = clamp(req.query.rows, 24, 1, 300);

      client.shell(
        { term: 'xterm-256color', cols, rows, width: 0, height: 0 },
        (err, stream: ClientChannel) => {
          if (err) {
            sendMsg({
              type: 'error',
              code: 'shell_failed',
              message: 'Could not start a shell on the server.',
            });
            socket.close(1011, 'shell failed');
            return;
          }
          if (closed) {
            stream.close(); // the browser left while the shell was starting
            return;
          }

          const tracker = new LineTracker();
          const alt = new AltScreenDetector();
          const decoder = new TextDecoder();
          let held: { rest: string } | undefined; // an Enter is waiting for the user's decision
          let drainTimer: NodeJS.Timeout | undefined;

          // ---- server -> browser -------------------------------------------------
          stream.on('data', (chunk: Buffer) => {
            alt.feed(chunk.toString('latin1'));
            if (socket.readyState !== socket.OPEN) return;
            socket.send(chunk, { binary: true });
            if (socket.bufferedAmount > HIGH_WATER && !drainTimer) {
              stream.pause();
              drainTimer = setInterval(() => {
                if (socket.bufferedAmount < LOW_WATER) {
                  clearInterval(drainTimer);
                  drainTimer = undefined;
                  stream.resume();
                }
              }, 20);
            }
          });

          stream.on('close', (code: number | null) => {
            clearInterval(drainTimer);
            if (socket.readyState === socket.OPEN) {
              sendMsg({ type: 'exit', code: code ?? null });
              socket.close(1000, 'shell exited');
            }
          });

          // ---- browser -> server -------------------------------------------------
          const handleInput = (text: string) => {
            if (held) return; // a confirmation is pending: ignore keystrokes meanwhile
            if (alt.active) {
              // vim/htop/less: keystrokes aren't shell commands, don't analyze them
              tracker.reset();
              stream.write(text);
              return;
            }
            const r = tracker.process(text);
            if (r.forward) stream.write(r.forward);
            if (r.hold) {
              held = { rest: r.hold.rest };
              sendMsg({ type: 'danger', command: r.hold.line, matches: r.hold.matches });
            }
          };

          const decide = (action: 'run' | 'cancel') => {
            if (!held) return;
            const { rest } = held;
            held = undefined;
            tracker.reset();
            if (action === 'run') {
              stream.write('\r'); // release the held Enter
              if (rest) handleInput(rest);
            } else {
              stream.write('\x03'); // Ctrl-C: abandon the line (works in emacs and vi mode)
            }
          };

          handler = (buf, isBinary) => {
            if (isBinary) return handleInput(decoder.decode(buf, { stream: true }));
            let msg;
            try {
              msg = TermClientMsgSchema.safeParse(JSON.parse(buf.toString('utf8')));
            } catch {
              return;
            }
            if (!msg.success) return;
            if (msg.data.type === 'resize') stream.setWindow(msg.data.rows, msg.data.cols, 0, 0);
            else decide(msg.data.action);
          };
          onClose = () => {
            clearInterval(drainTimer);
            stream.close();
          };

          // Input that arrived while the shell was starting.
          for (const m of queue.splice(0)) handler(m.buf, m.isBinary);

          sendMsg({ type: 'ready' });
        },
      );
    },
  );
}
