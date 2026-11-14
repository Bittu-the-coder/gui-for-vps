import { describe, expect, it } from 'vitest';
import { ACTIONS, listActions, previewAction } from './index.js';

const cmds = (id: string, params: object, sudo = 'sudo -n ') => {
  const r = previewAction(id, params, { sudo });
  return r.ok ? r.preview : r;
};

describe('M6 actions', () => {
  it('ctx.sudo decides the prefix', () => {
    expect(cmds('service.restart', { unit: 'nginx.service' })).toMatchObject({
      commands: ['sudo -n systemctl restart nginx.service'],
      risk: 'caution',
    });
    expect(cmds('service.restart', { unit: 'nginx.service' }, '')).toMatchObject({
      commands: ['systemctl restart nginx.service'],
    });
  });
  it('validates names strictly (no flags, no shell)', () => {
    expect(previewAction('service.stop', { unit: 'x; reboot.service' }).ok).toBe(false);
    expect(previewAction('service.stop', { unit: 'nginx' }).ok).toBe(false);
    expect(previewAction('docker.rm', { name: '-f' }).ok).toBe(false);
    expect(previewAction('docker.rm', { name: 'web; id' }).ok).toBe(false);
    expect(previewAction('process.kill', { pid: 0 }).ok).toBe(false);
    expect(previewAction('process.kill', { pid: 12.5 }).ok).toBe(false);
    expect(previewAction('services.logs', { unit: 'a.service', lines: 99999 }).ok).toBe(false);
  });
  it('stopping ssh or killing sshd / pid 1 is danger; others are not', () => {
    expect(cmds('service.stop', { unit: 'ssh.service' })).toMatchObject({ risk: 'danger' });
    expect(cmds('service.stop', { unit: 'nginx.service' })).toMatchObject({ risk: 'caution' });
    expect(cmds('process.kill', { pid: 812, name: 'sshd' })).toMatchObject({ risk: 'danger' });
    expect(cmds('process.kill', { pid: 1 })).toMatchObject({ risk: 'danger' });
    expect(cmds('process.kill', { pid: 5000, name: 'node' })).toMatchObject({
      risk: 'caution',
      commands: ['sudo -n kill -TERM 5000'],
    });
    expect(cmds('process.force-kill', { pid: 5000 })).toMatchObject({ risk: 'danger' });
  });
  it('quiet actions are safe, internal, and have a default log length', () => {
    const quiet = ACTIONS.filter((a) => a.quiet);
    expect(quiet.map((a) => a.id).sort()).toEqual([
      'backup.list',
      'devhub.detect',
      'docker.images',
      'docker.list',
      'docker.logs',
      'firewall.backups',
      'firewall.status',
      'map.cwds',
      'monitor.processes',
      'monitor.sample',
      'nginx.sites.list',
      'ports.list',
      'projects.list',
      'security.audit',
      'services.list',
      'services.logs',
    ]);
    for (const a of quiet) {
      expect(a.risk).toBe('safe');
      expect(a.internal).toBe(true);
    }
    expect(cmds('docker.logs', { name: 'web' })).toMatchObject({
      commands: ['sudo -n docker logs --tail 200 web 2>&1'],
    });
  });
  it('none of the quiet commands trips the danger detector', () => {
    for (const a of ACTIONS.filter((x) => x.quiet)) {
      const p = previewAction(a.id, { unit: 'a.service', name: 'web' });
      expect(p.ok && p.preview.matches).toEqual([]);
    }
  });
  it('only user-facing actions are listed for the Actions app', () => {
    expect(
      listActions().every((a) => !a.id.startsWith('docker.') && !a.id.startsWith('service')),
    ).toBe(true);
  });
});
