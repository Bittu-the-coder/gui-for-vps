import { describe, expect, it } from 'vitest';
import {
  branchName,
  envKeys,
  parseProjects,
  projectName,
  renderEnvFile,
  renderUnit,
  repoUrl,
  systemdQuote,
  userCommand,
} from './project.js';

const ok = (s: { safeParse: (v: unknown) => { success: boolean } }, v: unknown) =>
  s.safeParse(v).success;

describe('validators', () => {
  it('project names', () => {
    for (const n of ['my-app', 'a', 'app2']) expect(ok(projectName, n), n).toBe(true);
    for (const n of ['', '-a', 'A', 'a b', 'a/b', 'a;b', '../x', 'x'.repeat(50)])
      expect(ok(projectName, n), n).toBe(false);
  });
  it('repository addresses: real ones pass, anything git could read as an option or a local trick does not', () => {
    for (const u of [
      'https://github.com/user/repo.git',
      'ssh://git@host.example/repo.git',
      'git@github.com:user/repo.git',
      '/srv/git/repo.git',
    ])
      expect(ok(repoUrl, u), u).toBe(true);
    for (const u of [
      '--upload-pack=touch /tmp/x',
      '-c core.sshCommand=evil',
      'ext::sh -c touch% /tmp/x',
      'file:///etc',
      'http://insecure',
      '/srv/../etc/passwd',
      'https://a.com/x y',
      'https://a.com/x;y',
      '',
      'repo',
    ])
      expect(ok(repoUrl, u), u).toBe(false);
  });
  it('branches cannot start with a dash', () => {
    expect(ok(branchName, 'main')).toBe(true);
    expect(ok(branchName, 'release/1.2')).toBe(true);
    for (const b of ['-D', '--x', 'a b', 'a;b', '']) expect(ok(branchName, b), b).toBe(false);
  });
  it('user commands are a single line', () => {
    expect(ok(userCommand, 'npm ci && npm run build')).toBe(true);
    expect(ok(userCommand, 'a\nb')).toBe(false);
  });
});

describe('renderUnit', () => {
  const unit = renderUnit({ name: 'my-app', start: 'npm start', home: '/home/gfv', user: 'gfv' });
  it('runs as the given user in the project folder with its env file', () => {
    expect(unit).toContain('User=gfv');
    expect(unit).toContain('WorkingDirectory=/home/gfv/gfv-projects/my-app');
    expect(unit).toContain('EnvironmentFile=-/home/gfv/gfv-projects/my-app/.env');
    expect(unit).toContain('ExecStart=/bin/bash -lc "npm start"');
    expect(unit).toContain('Restart=on-failure');
    expect(unit).toContain('WantedBy=multi-user.target');
  });
  it('systemdQuote neutralises quotes, backslashes, % and $ (systemd expands the last two)', () => {
    expect(systemdQuote('a"b')).toBe('"a\\"b"');
    expect(systemdQuote('50%')).toBe('"50%%"');
    expect(systemdQuote('echo $HOME')).toBe('"echo $$HOME"');
    expect(systemdQuote('c:\\x')).toBe('"c:\\\\x"');
  });
  it('a hostile start command cannot add unit directives, even if validation were skipped', () => {
    const u = renderUnit({
      name: 'x',
      start: 'node a.js"\nExecStartPre=/bin/evil',
      home: '/h',
      user: 'u',
    });
    expect(u.split('\n').some((l) => l.startsWith('ExecStartPre'))).toBe(false); // the newline stayed inside the quoted argument
    expect(systemdQuote('a\nb')).toBe('"a\\nb"');
    expect(userCommand.safeParse('node a.js"\nExecStartPre=/bin/evil').success).toBe(false); // and the validator refuses it anyway
  });
});

describe('renderEnvFile', () => {
  it('quotes values and escapes quotes and backslashes', () => {
    const r = renderEnvFile({ PORT: '3000', MSG: 'say "hi" \\ bye', EMPTY: '' });
    expect(r).toEqual({ ok: true, text: 'PORT="3000"\nMSG="say \\"hi\\" \\\\ bye"\nEMPTY=""\n' });
  });
  it('refuses bad names and values that would break the format', () => {
    expect(renderEnvFile({ 'BAD NAME': 'x' })).toMatchObject({ ok: false });
    expect(renderEnvFile({ '1ABC': 'x' })).toMatchObject({ ok: false });
    expect(renderEnvFile({ A: 'line1\nline2' })).toMatchObject({ ok: false });
  });
  it('envKeys lists names only', () => {
    expect(envKeys('A="1"\n# c\nB_2="x"\n')).toEqual(['A', 'B_2']);
  });
});

describe('parseProjects', () => {
  const out = [
    '==PROJECT:web',
    'META:{"repo":"https://x/y.git","branch":"main","build":"npm ci","start":"npm start"}',
    'HEAD:abc1234',
    'ACTIVE:active',
    'ENV:yes',
    'UNIT:yes',
    'BEHIND:2',
    '==PROJECT:old',
    'META:not json',
    'ACTIVE:failed',
    'ENV:no',
    'UNIT:no',
  ].join('\n');
  const p = parseProjects(out);
  it('reads metadata, state and how far behind the remote it is', () => {
    expect(p[0]).toMatchObject({
      name: 'web',
      repo: 'https://x/y.git',
      build: 'npm ci',
      start: 'npm start',
      head: 'abc1234',
      active: 'active',
      hasEnv: true,
      hasUnit: true,
      behind: 2,
    });
  });
  it('survives a damaged metadata file', () => {
    expect(p[1]).toMatchObject({ name: 'old', active: 'failed', hasEnv: false });
    expect(p[1]!.behind).toBeUndefined();
  });
  it('is empty for no output', () => expect(parseProjects('')).toEqual([]));
});
