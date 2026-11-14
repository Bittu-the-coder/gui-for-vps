import { describe, expect, it } from 'vitest';
import { exportAs, type ExportFormat } from './formats.js';
import type { ExportInput } from './export.js';

const base: ExportInput = {
  name: 'Web stack',
  generatedAt: new Date('2026-11-14T10:00:00Z'),
  params: [
    { name: 'site', label: 'Site name', default: 'main' },
    { name: 'token', label: 'API token', secret: true },
  ],
  steps: [
    { actionId: 'files.mkdir', params: { path: '/var/www/{{site}}' } },
    {
      actionId: 'files.chmod',
      params: { path: '/var/www/{{site}}', mode: '750', recursive: true },
    },
    { actionId: 'devhub.install.git', params: {} },
    { actionId: 'service.restart', params: { unit: 'nginx.service' } },
    { actionId: 'files.rename', params: { from: '/tmp/a-{{token}}', to: '/tmp/b' } },
  ],
};
const text = (f: ExportFormat, input = base) =>
  exportAs(f, input)
    .files.map((x) => x.content)
    .join('\n');

describe('Dockerfile', () => {
  const r = exportAs('dockerfile', base);
  const df = r.files[0]!.content;
  it('builds from Ubuntu as root: no sudo, no raw placeholders', () => {
    expect(df).toContain('FROM ubuntu:24.04');
    expect(df).not.toContain('$SUDO');
    expect(df).not.toContain('sudo');
    expect(df).not.toContain('{{');
  });
  it('declares build arguments and uses them as quoted variables', () => {
    expect(df).toContain('ARG GFV_SITE="main"');
    expect(df).toContain('RUN mkdir -p -- /var/www/"${GFV_SITE}"');
  });
  it('a secret or required parameter has no default and must be provided, with a warning', () => {
    expect(df).toMatch(/^ARG GFV_TOKEN$/m);
    expect(df).toContain('RUN test -n "${GFV_TOKEN}" ||');
    expect(df).toContain('SECRET');
  });
  it('leaves out steps that only make sense on a running machine, and says so', () => {
    expect(df).not.toContain('systemctl');
    expect(df).toContain('Skipped: "Restart a service"');
    expect(r.notes.join(' ')).toContain('Restart a service');
  });
  it('every RUN is one line (no multi-line instruction can swallow the next step)', () => {
    for (const l of df.split('\n')) if (l.startsWith('RUN ')) expect(l).not.toContain('\\\n');
  });
});

describe('Docker Compose', () => {
  const r = exportAs('compose', base);
  it('gives a compose file AND the Dockerfile it builds', () => {
    expect(r.files.map((f) => f.name)).toEqual(['docker-compose.yml', 'Dockerfile']);
  });
  it('passes parameters as build args; required ones must be set', () => {
    const y = r.files[0]!.content;
    expect(y).toContain('GFV_SITE: "${GFV_SITE:-main}"');
    expect(y).toContain('GFV_TOKEN: "${GFV_TOKEN:?set GFV_TOKEN}"');
    expect(y).toContain('context: .');
  });
});

describe('Ansible playbook', () => {
  const y = text('ansible');
  it('uses real modules where there is one', () => {
    expect(y).toContain(
      'ansible.builtin.file:\n        path: "/var/www/{{ site }}"\n        state: directory',
    );
    expect(y).toContain('mode: "0750"');
    expect(y).toContain('recurse: true');
    expect(y).toContain(
      'ansible.builtin.systemd:\n        name: "nginx.service"\n        state: restarted',
    );
  });
  it('falls back to a shell task otherwise, with parameters passed as environment variables', () => {
    expect(y).toContain('ansible.builtin.shell: |');
    expect(y).toContain(
      'environment:\n        GFV_SITE: "{{ site }}"\n        GFV_TOKEN: "{{ token }}"',
    );
    expect(y).toContain('executable: /bin/bash');
  });
  it('declares defaults as vars and secrets/required as prompts', () => {
    expect(y).toContain('vars:\n    site: "main"');
    expect(y).toContain('vars_prompt:\n    - name: token');
    expect(y).toContain('private: true');
  });
  it('is one task per step, in order, with a clean two-space structure', () => {
    const names = [...y.matchAll(/^ {4}- name: "(Step \d+\/5[^"]*)"/gm)].map((m) => m[1]);
    expect(names).toHaveLength(5);
    expect(names[0]).toContain('Step 1/5');
    for (const l of y.split('\n')) {
      if (l === '' || l.startsWith('#') || l === '---') continue;
      expect(l.search(/\S/) % 2, `odd indentation: ${l}`).toBe(0);
    }
  });
  it('never pastes a parameter value into shell text, even a hostile default', () => {
    const evil = 'a"; touch /tmp/pwned; echo "$(id)';
    const out = exportAs('ansible', {
      ...base,
      params: [
        { name: 'site', label: 'Site', default: evil },
        { name: 'token', label: 'T', secret: true },
      ],
    }).files[0]!.content;
    const shellLines = out
      .split('\n')
      .filter((l) => l.startsWith('        ') && !l.includes('GFV_') && !l.includes('path:'));
    for (const l of shellLines) expect(l).not.toContain('touch /tmp/pwned');
    // It appears exactly once: as the (JSON-quoted) variable default.
    expect(out.split('touch /tmp/pwned').length - 1).toBe(1);
    expect(out).toContain(JSON.stringify(evil));
  });
});

describe('all formats', () => {
  it.each(['dockerfile', 'compose', 'ansible'] as const)(
    '%s: an empty recipe still produces a valid, labelled file',
    (f) => {
      const out = text(f, { ...base, steps: [], params: [] });
      expect(out.length).toBeGreaterThan(20);
      expect(out).toMatch(/no steps|\[\]/);
    },
  );
  it('an action that no longer exists is reported, not silently dropped', () => {
    for (const f of ['dockerfile', 'ansible'] as const) {
      const r = exportAs(f, {
        ...base,
        params: [],
        steps: [{ actionId: 'gone.action', params: {} }],
      });
      expect(r.notes.join(' ')).toContain('gone.action');
    }
  });
  it('bash goes through the same entry point, unchanged', () => {
    const r = exportAs('bash', base);
    expect(r.files[0]!.name).toBe('recipe.sh');
    expect(r.files[0]!.content.startsWith('#!/usr/bin/env bash')).toBe(true);
  });
});
