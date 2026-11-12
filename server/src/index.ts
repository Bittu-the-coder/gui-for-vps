import { buildApp } from './app.js';
import { createToken } from './auth.js';

const HOST = '127.0.0.1'; // never 0.0.0.0 — local mode only
const PORT = Number(process.env.GFV_PORT ?? 4310);

const token = createToken();
const app = await buildApp(token);
await app.listen({ host: HOST, port: PORT });
