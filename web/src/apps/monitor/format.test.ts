import { describe, expect, it } from 'vitest';
import { bytes, duration } from './format';

describe('format', () => {
  it('bytes', () => {
    expect(bytes(500)).toBe('500 B');
    expect(bytes(1536)).toBe('1.5 KB');
    expect(bytes(3 * 1024 ** 3)).toBe('3.0 GB');
  });
  it('duration', () => {
    expect(duration(59)).toBe('0m');
    expect(duration(3700)).toBe('1h 1m');
    expect(duration(90000)).toBe('1d 1h');
  });
});
