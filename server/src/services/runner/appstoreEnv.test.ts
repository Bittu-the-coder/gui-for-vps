import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { previewAction } from '@gfv/shared';

// The password-generation command, run for real in /bin/sh: private file, random, and stable across a re-install.
describe('app passwords are generated on the server', () => {
  const home = mkdtempSync(join(tmpdir(), 'gfv-apps-'));
  const p = previewAction(
    'apps.install',
    { app: 'grafana', hostPort: 3000, expose: false },
    { sudo: '', home },
  );
  if (!p.ok) throw new Error('x');
  const gen = p.preview.commands.find((c) => c.includes('/dev/urandom'))!;
  const file = join(home, '.gfv', 'apps', 'grafana.env');
  const run = () => execFileSync('sh', ['-c', gen], { env: { ...process.env, HOME: home } });

  it('writes a 600 file with a 24-character random password', () => {
    run();
    expect(statSync(file).mode & 0o777).toBe(0o600);
    expect(readFileSync(file, 'utf8')).toMatch(/^GF_SECURITY_ADMIN_PASSWORD=[A-Za-z0-9]{24}\n$/);
  });
  it('a second install keeps the same password (your data and your login stay in step)', () => {
    const before = readFileSync(file, 'utf8');
    run();
    expect(readFileSync(file, 'utf8')).toBe(before);
  });
  it('an app without secrets still gets an (empty) env file, so --env-file never fails', () => {
    const q = previewAction(
      'apps.install',
      { app: 'whoami', hostPort: 8081, expose: false },
      { sudo: '', home },
    );
    if (!q.ok) throw new Error('x');
    execFileSync('sh', ['-c', q.preview.commands.find((c) => c.includes('umask 077'))!], {
      env: { ...process.env, HOME: home },
    });
    expect(readFileSync(join(home, '.gfv', 'apps', 'whoami.env'), 'utf8')).toBe('');
  });
});
