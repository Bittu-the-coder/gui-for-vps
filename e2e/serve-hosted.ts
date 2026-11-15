// GFV in HOSTED mode (accounts, 2FA, roles, audit) on its own port and an empty data directory, for e2e/25-hosted.spec.ts.
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

process.env.GFV_HOME = mkdtempSync(join(tmpdir(), 'gfv-e2e-hosted-'));
const { startServer } = await import('../server/src/start.js');
await startServer({
  port: 4398,
  token: 'unused',
  webDir: resolve(import.meta.dirname, '../web/dist'),
  hosted: { publicUrl: 'https://gfv.example.test', setupToken: 'e2e-setup-token-123456' },
});
