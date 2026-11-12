import { describe, expect, it } from 'vitest';
import { shellQuote } from './shell.js';

describe('shellQuote', () => {
  it('leaves plain words alone', () => {
    expect(shellQuote('/var/log/syslog')).toBe('/var/log/syslog');
    expect(shellQuote('nginx.service')).toBe('nginx.service');
  });
  it('quotes the empty string, spaces and leading dashes', () => {
    expect(shellQuote('')).toBe("''");
    expect(shellQuote('my file')).toBe("'my file'");
    expect(shellQuote('-rf')).toBe("'-rf'");
  });
  it('neutralises shell metacharacters', () => {
    expect(shellQuote('$(reboot)')).toBe("'$(reboot)'");
    expect(shellQuote('a; rm -rf /')).toBe("'a; rm -rf /'");
    expect(shellQuote('`id`')).toBe("'`id`'");
    expect(shellQuote('~')).toBe("'~'");
  });
  it('escapes embedded single quotes', () => {
    expect(shellQuote("it's")).toBe(`'it'\\''s'`);
  });
  it('rejects NUL bytes', () => {
    expect(() => shellQuote('a\0b')).toThrow();
  });
});
