import { describe, expect, it } from 'vitest';
import { ACTIONS, actionById, previewAction, redactParams, redactSecrets } from './index.js';
import { defineAction } from './define.js';
import { z } from 'zod';

describe('previewAction', () => {
  it('rejects unknown actions and bad params', () => {
    expect(previewAction('nope', {})).toEqual({ ok: false, error: 'unknown_action' });
    const r = previewAction('files.delete-path', { path: 'relative' });
    expect(r.ok).toBe(false);
  });
  it('builds commands and keeps declared risk', () => {
    const r = previewAction('system.uptime', {});
    expect(r.ok && r.preview.commands).toEqual(['uptime']);
    expect(r.ok && r.preview.risk).toBe('safe');
  });
  it('quotes params instead of concatenating', () => {
    const r = previewAction('files.delete-path', { path: "/tmp/a b; reboot '" });
    expect(r.ok && r.preview.commands[0]).toBe(`rm -rf -- '/tmp/a b; reboot '\\'''`);
  });
  it('the detector raises risk but never lowers it', () => {
    const r = previewAction('files.delete-path', { path: '/etc' });
    expect(r.ok && r.preview.risk).toBe('danger');
    expect(r.ok && r.preview.matches.length).toBeGreaterThan(0);
    const caution = previewAction('system.clear-apt-cache', {});
    expect(caution.ok && caution.preview.risk).toBe('caution');
  });
  it('every action id is unique and non-safe actions explain why', () => {
    expect(new Set(ACTIONS.map((a) => a.id)).size).toBe(ACTIONS.length);
    for (const a of ACTIONS) if (a.risk !== 'safe') expect(a.riskReason).toBeTruthy();
  });
});

describe('redaction', () => {
  const a = defineAction({
    id: 't',
    title: 't',
    explain: 't',
    params: z.object({ pw: z.string() }),
    commands: ({ pw }) => [`echo ${pw}`],
    risk: 'safe',
    recordable: false,
    secretParams: ['pw'],
  });
  it('hides secret params and their values in text', () => {
    expect(redactParams(a, { pw: 'hunter2' })).toEqual({ pw: '***' });
    expect(redactSecrets(a, { pw: 'hunter2' }, 'echo hunter2')).toBe('echo ***');
  });
  it('finds samples by id', () => expect(actionById('system.uptime')?.risk).toBe('safe'));
});
