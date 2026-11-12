import { describe, expect, it } from 'vitest';
import { AltScreenDetector } from './altScreen';

describe('AltScreenDetector', () => {
  it('turns on when a full-screen program starts and off when it exits', () => {
    const d = new AltScreenDetector();
    expect(d.feed('prompt$ htop\r\n')).toBe(false);
    expect(d.feed('\x1b[?1049h\x1b[H...')).toBe(true);
    expect(d.feed('more drawing')).toBe(true);
    expect(d.feed('\x1b[?1049l')).toBe(false);
  });

  it('handles a sequence split across chunks', () => {
    const d = new AltScreenDetector();
    d.feed('abc\x1b[?10');
    expect(d.feed('49h')).toBe(true);
  });

  it('uses the last toggle when both appear in one chunk', () => {
    const d = new AltScreenDetector();
    expect(d.feed('\x1b[?1049h...\x1b[?1049l')).toBe(false);
  });

  it('recognises the older ?47 and ?1047 variants', () => {
    expect(new AltScreenDetector().feed('\x1b[?47h')).toBe(true);
    expect(new AltScreenDetector().feed('\x1b[?1047h')).toBe(true);
  });
});
