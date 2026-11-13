import { describe, expect, it } from 'vitest';
import { commandNames } from './learn.js';

describe('commandNames', () => {
  it('skips sudo and its flags', () =>
    expect(commandNames('sudo -n apt-get clean')).toEqual(['apt-get']));
  it('splits pipelines and chains', () =>
    expect(commandNames('df -h / && uptime | cat')).toEqual(['df', 'uptime', 'cat']));
  it('skips env assignments and path prefixes', () =>
    expect(commandNames('LANG=C /usr/bin/ls -la')).toEqual(['ls']));
  it('skips shell syntax words and reads the command after them', () =>
    expect(commandNames('if [ -e f ]; then sudo cat f > g; else echo no; fi; exit 1')).toEqual([
      'cat',
      'echo',
    ]));
  it('ignores quoted junk-only segments', () => expect(commandNames("'")).toEqual([]));
});
