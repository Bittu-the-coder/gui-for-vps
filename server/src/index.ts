import { createToken } from './auth.js';
import { startServer } from './start.js';

// Development: the Vite dev server serves the web app and proxies /api here with the token.
await startServer({
  port: Number(process.env.GFV_PORT ?? 4310),
  token: createToken(),
  devWebPort: 5173,
});
