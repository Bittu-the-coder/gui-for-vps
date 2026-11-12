import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

const apiPort = process.env.GFV_PORT ?? '4310';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    proxy: {
      // In dev the proxy forwards /api to Fastify and injects the session token,
      // so the browser never has to know it.
      '/api': {
        target: `http://127.0.0.1:${apiPort}`,
        ws: true,
        headers: { 'x-gfv-token': process.env.GFV_TOKEN ?? '' },
      },
    },
  },
});
