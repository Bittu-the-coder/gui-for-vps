import type { FastifyInstance } from 'fastify';
import type { AppContext } from '../context.js';

/**
 * Live push channel. The session token is already enforced by the global onRequest hook
 * (it runs on the upgrade request too). Browsers can't set headers on WebSockets, so in
 * production the token arrives as a cookie; in dev the Vite proxy adds the header.
 * On top of that we check Origin, so a random website can't open the socket.
 */
export function wsRoutes(app: FastifyInstance, { pool, allowedOrigins }: AppContext): void {
  app.get('/api/ws', { websocket: true }, (socket, req) => {
    const origin = req.headers.origin;
    // Non-browser clients send no Origin; the token still protects them.
    if (origin !== undefined && !allowedOrigins.includes(origin)) {
      socket.close(1008, 'origin not allowed');
      return;
    }
    const send = () =>
      socket.send(JSON.stringify({ type: 'connections', statuses: pool.allStatuses() }));
    pool.on('status', send);
    socket.on('close', () => pool.off('status', send));
    send();
  });
}
