import { describe, expect, it } from 'vitest';
import { LineTracker } from './lineTracker';

const t = () => new LineTracker();

describe('LineTracker', () => {
  it('passes harmless commands straight through', () => {
    expect(t().process('ls -la\r')).toEqual({ forward: 'ls -la\r' });
  });

  it('holds the Enter on a dangerous line and forwards everything before it', () => {
    const r = t().process('ufw disable\r');
    expect(r.forward).toBe('ufw disable');
    expect(r.hold?.line).toBe('ufw disable');
    expect(r.hold?.matches[0]?.id).toBe('ufw-off');
    expect(r.hold?.rest).toBe('');
  });

  it('works across chunks (keystroke by keystroke)', () => {
    const tr = t();
    let held;
    for (const ch of 'ufw disable\r') held = tr.process(ch).hold ?? held;
    expect(held?.matches[0]?.id).toBe('ufw-off');
  });

  it('honours backspace', () => {
    expect(t().process('ufw disablee\x7f\r').hold).toBeDefined();
    expect(t().process('ufw disabl\x7f\x7f\x7f\x7f\x7f\x7f\x7fls\r').hold).toBeUndefined();
  });

  it('Ctrl-U and Ctrl-C clear the line', () => {
    expect(t().process('ufw disable\x15ls\r').hold).toBeUndefined();
    expect(t().process('ufw disable\x03ls\r').hold).toBeUndefined();
  });

  it('Ctrl-W deletes the last word', () => {
    expect(t().process('echo hi ufw disable\x17\x17\x17\x17\r').hold).toBeUndefined();
  });

  it('withholds the rest of a multi-line paste after the dangerous line', () => {
    const r = t().process('ufw disable\rls\r');
    expect(r.forward).toBe('ufw disable');
    expect(r.hold?.rest).toBe('ls\r');
  });

  it('treats CRLF as one Enter', () => {
    expect(t().process('ufw disable\r\nls\r').hold?.rest).toBe('ls\r');
  });

  it('forwards earlier safe lines of a paste, then holds the dangerous one', () => {
    const r = t().process('echo a\rufw disable\rls\r');
    expect(r.forward).toBe('echo a\rufw disable');
    expect(r.hold?.rest).toBe('ls\r');
  });

  it('bracketed paste: a newline inside the paste does not count as Enter', () => {
    const tr = t();
    const pasted = tr.process('\x1b[200~ufw disable\n\x1b[201~');
    expect(pasted.hold).toBeUndefined();
    const enter = tr.process('\r');
    expect(enter.hold?.matches[0]?.id).toBe('ufw-off');
  });

  it('escape sequences are not typed text, even when split across chunks', () => {
    const tr = t();
    tr.process('\x1b');
    tr.process('[');
    tr.process('A'); // Up arrow
    const r = tr.process('\r');
    expect(r.hold).toBeUndefined();
    expect(tr.uncertain).toBe(false); // reset by Enter
  });

  it('marks the line uncertain after history / completion keys', () => {
    const tr = t();
    tr.process('\x1b[A');
    expect(tr.uncertain).toBe(true);
    const tr2 = t();
    tr2.process('rm\t');
    expect(tr2.uncertain).toBe(true);
  });

  it('reset() forgets the pending line', () => {
    const tr = t();
    tr.process('ufw disable');
    tr.reset();
    expect(tr.process('\r').hold).toBeUndefined();
  });
});
