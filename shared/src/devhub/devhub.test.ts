import { describe, expect, it } from 'vitest';
import { previewAction } from '../actions/index.js';
import { parseDetect } from './detect.js';
import { DISTRO_GUARD, NVM_SHA256, NVM_URL, TOOL_IDS, TOOLS } from './tools.js';

const preview = (id: string, sudo = 'sudo -n ') => {
  const r = previewAction(id, {}, { sudo });
  if (!r.ok) throw new Error(`${id}: ${r.error}`);
  return r.preview;
};

describe('install commands', () => {
  it('every tool installs and uninstalls, and installs start with the distro guard', () => {
    expect(TOOLS.map((t) => t.id)).toEqual([...TOOL_IDS]);
    for (const t of TOOLS) {
      const i = preview(`devhub.install.${t.id}`);
      expect(i.commands[0]).toBe(DISTRO_GUARD);
      expect(i.longRunning).toBe(true);
      expect(preview(`devhub.uninstall.${t.id}`).commands.length).toBeGreaterThan(0);
    }
  });
  it('apt runs non-interactively and waits for the lock, with sudo only when needed', () => {
    const sudo = preview('devhub.install.git').commands;
    expect(sudo[1]).toBe(
      'sudo -n env DEBIAN_FRONTEND=noninteractive apt-get -y -q -o DPkg::Lock::Timeout=120 update',
    );
    expect(sudo[2]).toContain('apt-get -y -q -o DPkg::Lock::Timeout=120 install git');
    const root = preview('devhub.install.git', '').commands;
    expect(root[1]).toMatch(/^env DEBIAN_FRONTEND=noninteractive apt-get/);
    expect(root.join('\n')).not.toContain('sudo');
  });
  it('node: pinned download, checksum verified BEFORE running, nothing piped to a shell', () => {
    const c = preview('devhub.install.node').commands;
    const dl = c.findIndex((x) => x.includes(NVM_URL));
    const sum = c.findIndex(
      (x) => x.includes(`${NVM_SHA256}  /tmp/gfv-nvm-install.sh`) && x.includes('sha256sum -c'),
    );
    const run = c.findIndex((x) => x.startsWith('bash /tmp/gfv-nvm-install.sh'));
    expect(dl).toBeGreaterThan(-1);
    expect(sum).toBeGreaterThan(dl);
    expect(run).toBeGreaterThan(sum);
    expect(c.join('\n')).not.toMatch(/\|\s*(ba)?sh\b/);
    expect(c.at(-1)).toContain('nvm install 22');
    // user-level install: no sudo around nvm or node
    expect(c.slice(dl).join('\n')).not.toContain('sudo');
  });
  it('docker: no docker-group change', () => {
    expect(preview('devhub.install.docker').commands.join('\n')).not.toMatch(
      /usermod|docker group|get\.docker/,
    );
  });
  it('uninstall keeps data; only the purge action is danger and deletes databases', () => {
    for (const t of TOOLS) {
      const u = preview(`devhub.uninstall.${t.id}`);
      expect(u.commands.join('\n')).not.toMatch(/\bpurge\b|\/var\/lib/);
      expect(u.risk).toBe('caution');
    }
    const p = preview('devhub.purge.postgresql');
    expect(p.risk).toBe('danger');
    expect(p.commands.join('\n')).toContain('/var/lib/postgresql');
  });
  it('install previews are caution, never flagged danger by the detector', () => {
    for (const t of TOOLS) expect(preview(`devhub.install.${t.id}`).risk).toBe('caution');
  });
});

describe('parseDetect', () => {
  const text = `==os
PRETTY_NAME="Ubuntu 24.04.1 LTS"
ID=ubuntu
ID_LIKE=debian
==node
v22.5.1
==python
Python 3.12.3
==docker
NOTFOUND
==docker.active

==postgresql
psql (PostgreSQL) 16.4 (Ubuntu 16.4-0ubuntu0.24.04.1)
==postgresql.active
active
==nginx
nginx version: nginx/1.24.0 (Ubuntu)
==nginx.active
inactive
==git
git version 2.43.0
`;
  const s = parseDetect(text);
  it('reads versions, installed state and service state', () => {
    expect(s.tools.node).toEqual({ installed: true, version: '22.5.1' });
    expect(s.tools.python).toEqual({ installed: true, version: '3.12.3' });
    expect(s.tools.docker).toEqual({ installed: false });
    expect(s.tools.postgresql).toEqual({ installed: true, version: '16.4', running: true });
    expect(s.tools.nginx).toEqual({ installed: true, version: '1.24.0', running: false });
    expect(s.tools.git.version).toBe('2.43.0');
  });
  it('knows if the distro is supported', () => {
    expect(s.os).toEqual({ pretty: 'Ubuntu 24.04.1 LTS', supported: true });
    expect(parseDetect('==os\nID=fedora\nPRETTY_NAME="Fedora 40"\n').os.supported).toBe(false);
    expect(parseDetect('').os.supported).toBe(false);
  });
  it('treats missing sections as not installed', () => {
    expect(parseDetect('').tools.git).toEqual({ installed: false });
  });
});
