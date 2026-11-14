import { execFileSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir, userInfo } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { backupSchema, renderScript } from '@gfv/shared';

// The generated backup script, run for real in /bin/sh on a temp directory: real tar, real retention.
describe('the backup script', () => {
  const home = mkdtempSync(join(tmpdir(), 'gfv-bk-'));
  const data = join(home, 'data');
  mkdirSync(join(data, 'sub'), { recursive: true });
  writeFileSync(join(data, 'a.txt'), 'hello');
  writeFileSync(join(data, 'sub', 'b.txt'), 'world');
  const spec = backupSchema.parse({
    name: 'demo',
    paths: [data],
    frequency: 'daily',
    hour: 3,
    keep: 2,
  });
  const script = join(home, 'backup.sh');
  writeFileSync(script, renderScript(spec, home, userInfo().username));
  const run = () => execFileSync('sh', [script], { encoding: 'utf8' });
  const dest = join(home, '.gfv', 'backups', 'demo');

  it('is valid shell', () => {
    execFileSync('sh', ['-n', script]);
  });
  it('writes a private archive whose contents restore into any folder', () => {
    expect(run()).toContain('Backup written:');
    const files = readdirSync(dest).filter((f) => f.endsWith('.tar.gz'));
    expect(files).toHaveLength(1);
    expect(files[0]).toMatch(/^\d{8}-\d{6}\.tar\.gz$/);
    const mode = execFileSync('stat', ['-c', '%a', join(dest, files[0]!)], {
      encoding: 'utf8',
    }).trim();
    expect(mode).toBe('600');
    const out = join(home, 'restored');
    mkdirSync(out);
    execFileSync('tar', ['-xzf', join(dest, files[0]!), '-C', out]);
    expect(readFileSync(join(out, data.slice(1), 'a.txt'), 'utf8')).toBe('hello');
    expect(readFileSync(join(out, data.slice(1), 'sub', 'b.txt'), 'utf8')).toBe('world');
  });
  it('keeps only the newest N archives, and leaves no half-written file', () => {
    execFileSync('sleep', ['1.1']);
    run();
    execFileSync('sleep', ['1.1']);
    run();
    const files = readdirSync(dest);
    expect(files.filter((f) => f.endsWith('.tar.gz'))).toHaveLength(2);
    expect(files.some((f) => f.endsWith('.partial'))).toBe(false);
  });
  it('a missing folder fails loudly instead of writing an empty backup', () => {
    const bad = join(home, 'bad.sh');
    writeFileSync(
      bad,
      renderScript(
        backupSchema.parse({ ...spec, name: 'gone', paths: [join(home, 'nope')] }),
        home,
        userInfo().username,
      ),
    );
    expect(() => execFileSync('sh', [bad], { stdio: 'pipe' })).toThrow();
    expect(existsSync(join(home, '.gfv', 'backups', 'gone'))).toBe(true);
    expect(
      readdirSync(join(home, '.gfv', 'backups', 'gone')).filter((f) => f.endsWith('.tar.gz')),
    ).toHaveLength(0);
  });
});
