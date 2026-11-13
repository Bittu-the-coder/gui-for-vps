import { describe, expect, it } from 'vitest';
import { previewAction } from './index.js';

describe('file actions', () => {
  it('quote every path', () => {
    const r = previewAction('files.rename', { from: '/a/my file', to: '/a/$(x)' });
    expect(r.ok && r.preview.commands).toEqual([`mv -nT -- '/a/my file' '/a/$(x)'`]);
    const m = previewAction('files.mkdir', { path: '/tmp/a b' });
    expect(m.ok && m.preview.commands).toEqual([`mkdir -p -- '/tmp/a b'`]);
  });
  it('chmod validates the mode (no injection through it) and is caution', () => {
    expect(previewAction('files.chmod', { path: '/a', mode: '644; reboot' }).ok).toBe(false);
    const r = previewAction('files.chmod', { path: '/a', mode: '755', recursive: true });
    expect(r.ok && r.preview.commands).toEqual(['chmod -R 755 -- /a']);
    expect(r.ok && r.preview.risk).toBe('caution');
  });
  it('chmod 777 is flagged by the detector with a reason', () => {
    const r = previewAction('files.chmod', { path: '/srv/app', mode: '777' });
    expect(r.ok && r.preview.reasons.length).toBeGreaterThan(1);
  });
});
