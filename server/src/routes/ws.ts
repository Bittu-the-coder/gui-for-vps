import type { FastifyInstance } from 'fastify';
import type { AppContext } from '../context.js';
import { originAllowed } from './origin.js';

/**
 * Live push channel. The session token is already enforced by the global onRequest hook
 * (it runs on the upgrade request too). Browsers can't set headers on WebSockets, so in
 * production the token arrives as a cookie; in dev the Vite proxy adds the header.
 * On top of that we check Origin, so a random website can't open the socket.
 */
export function wsRoutes(app: FastifyInstance, { pool, allowedOrigins }: AppContext): void {
  app.get('/api/ws', { websocket: true }, (socket, req) => {
    if (!originAllowed(req.headers.origin, allowedOrigins)) {
      socket.close(1008, 'origin not allowed');
      return;
    }
    // A member only learns about the servers they may use.
    const send = () =>
      socket.send(
        JSON.stringify({
          type: 'connections',
          statuses: Object.fromEntries(
            Object.entries(pool.allStatuses()).filter(
              ([id]) => req.accessible === 'all' || req.accessible.includes(id),
            ),
          ),
        }),
      );
    pool.on('status', send);
    socket.on('close', () => pool.off('status', send));
    send();
  });
}
