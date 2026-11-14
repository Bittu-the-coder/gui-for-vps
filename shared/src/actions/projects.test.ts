import { describe, expect, it } from 'vitest';
import { previewAction } from './index.js';

const ctx = { sudo: 'sudo -n ', home: '/home/gfv', user: 'gfv' };
const prev = (id: string, params: unknown, c: typeof ctx = ctx) => {
  const p = previewAction(id, params, c);
  if (!p.ok) throw new Error(JSON.stringify(p));
  return p.preview;
};
const refused = (id: string, params: unknown) => !previewAction(id, params, ctx).ok;

describe('projects.deploy', () => {
  const p = prev('projects.deploy', {
    name: 'my-app',
    repo: 'https://github.com/u/r.git',
    build: 'npm ci && npm run build',
    start: 'npm start',
  });
  const text = p.commands.join('\n');
  it('checks for git, clones with -- and quoted values, never prompts for a password', () => {
    expect(text).toContain('command -v git');
    expect(text).toContain(
      'clone --branch main -- https://github.com/u/r.git "$HOME/gfv-projects/my-app"',
    );
    expect(text).toContain('GIT_TERMINAL_PROMPT=0');
  });
  it('an existing checkout is fetched and reset to the branch (and says so)', () => {
    expect(text).toContain('fetch --prune origin');
    expect(text).toContain('reset --hard origin/main');
    expect(p.explain).toContain('reset --hard');
  });
  it('the build command is ONE quoted argument to bash -c, run inside the project folder', () => {
    expect(text).toContain(`cd "$HOME/gfv-projects/my-app" && bash -c 'npm ci && npm run build'`);
  });
  it('saves the settings and restarts the service only if one is installed', () => {
    expect(text).toContain('.gfv-project.json');
    expect(text).toContain(
      'if [ -e /etc/systemd/system/gfv-my-app.service ]; then sudo -n systemctl restart gfv-my-app.service; fi',
    );
  });
  it('is a caution action that names the real risk', () => {
    expect(p.risk).toBe('caution');
    expect(p.reasons.join(' ')).toContain('runs the build command');
    expect(p.longRunning).toBe(true);
  });
  it('a build command with quotes and shell syntax stays inside its quotes', () => {
    const t = prev('projects.deploy', {
      name: 'a',
      repo: '/srv/git/a.git',
      build: `echo 'hi'; rm -rf x`,
    }).commands.join('\n');
    expect(t).toContain(`bash -c 'echo '\\''hi'\\''; rm -rf x'`);
  });
  it('refuses names, repositories and branches that could be options or paths', () => {
    expect(refused('projects.deploy', { name: '../x', repo: '/srv/a.git' })).toBe(true);
    expect(refused('projects.deploy', { name: 'a', repo: '--upload-pack=touch /tmp/x' })).toBe(
      true,
    );
    expect(refused('projects.deploy', { name: 'a', repo: 'ext::sh -c id' })).toBe(true);
    expect(refused('projects.deploy', { name: 'a', repo: '/srv/a.git', branch: '--delete' })).toBe(
      true,
    );
    expect(refused('projects.deploy', { name: 'a', repo: '/srv/a.git', build: 'a\nb' })).toBe(true);
  });
});

describe('the other project actions', () => {
  it('env.install moves the uploaded file into place with mode 600 and removes the temp file', () => {
    const p = prev('projects.env.install', { name: 'web', tmp: '/tmp/gfv-env-abcdef1234' });
    const t = p.commands.join('\n');
    expect(t).toContain('install -m 600 -- /tmp/gfv-env-abcdef1234 "$HOME/gfv-projects/web"/.env');
    expect(t).toContain('rm -f -- /tmp/gfv-env-abcdef1234');
    expect(refused('projects.env.install', { name: 'web', tmp: '/etc/passwd' })).toBe(true);
    expect(refused('projects.env.install', { name: 'web', tmp: '/tmp/gfv-env-../../etc' })).toBe(
      true,
    );
  });
  it('service.install writes a unit for YOUR user, backs up an existing one first, reloads and enables', () => {
    const p = prev('projects.service.install', { name: 'web', start: 'npm start' });
    const t = p.commands.join('\n');
    expect(p.commands[0]).toContain('.gfv/snapshots'); // the backup step is first
    expect(t).toContain('User=gfv');
    expect(t).toContain('tee /etc/systemd/system/gfv-web.service');
    expect(t).toContain('systemctl daemon-reload');
    expect(t).toContain('systemctl enable --now gfv-web.service');
    expect(p.risk).toBe('caution');
    expect(refused('projects.service.install', { name: 'web', start: '' })).toBe(true);
  });
  it('remove is danger (it deletes the folder and .env) and backs the unit up', () => {
    const p = prev('projects.remove', { name: 'web' });
    expect(p.risk).toBe('danger');
    expect(p.commands.join('\n')).toContain('rm -rf -- "$HOME/gfv-projects/web"');
    expect(p.commands[0]).toContain('.gfv/snapshots');
  });
  it('fetch is safe and changes nothing; list is a quiet read', () => {
    expect(prev('projects.fetch', { name: 'web' }).risk).toBe('safe');
    expect(prev('projects.list', {}).commands[0]).toContain('==PROJECT:');
  });
});
