import { execFileSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { guardStartCommands, ufwGuard } from '@gfv/shared';

// The lockout-protection timer, run for real in /bin/sh (with a stub `sudo`), no server needed.
describe('the guard wrapper on a real shell', () => {
  const ctx = { sudo: 'sudo -n ', sshPort: 22 };
  it('the unattended revert script is valid shell, and the timer command runs in sh', () => {
    const cmds = guardStartCommands(ufwGuard, 'run-12345678', 'T', ctx);
    // The script is the text between the printf quotes of the third command: extract it by running the
    // command with a fake HOME and sudo, then `sh -n` the file the command wrote.
    const home = execFileSync('mktemp', ['-d'], { encoding: 'utf8' }).trim();
    const stubDir = execFileSync('mktemp', ['-d'], { encoding: 'utf8' }).trim();
    execFileSync('sh', [
      '-c',
      `printf '#!/bin/sh\\nexit 0\\n' > ${stubDir}/sudo && chmod +x ${stubDir}/sudo`,
    ]);
    const env = { ...process.env, HOME: home, PATH: `${stubDir}:${process.env.PATH}` };
    execFileSync('sh', ['-c', cmds[0]!], { env });
    // save step would copy /etc/ufw: make the stub directories exist instead of touching the real system
    execFileSync(
      'sh',
      [
        '-c',
        `mkdir -p "$HOME/.gfv/guard/run-12345678/etc-ufw"; touch "$HOME/.gfv/guard/run-12345678/default-ufw"`,
      ],
      { env },
    );
    execFileSync('sh', ['-c', cmds[2]!.replace('sleep 40', 'sleep 0')], { env });
    execFileSync('sh', ['-n', `${home}/.gfv/guard/run-12345678/revert.sh`]);
    // The timer fires (sleep 0), finds no ok file, runs the script (stubbed sudo): it leaves a marker.
    execFileSync('sh', ['-c', 'sleep 1'], { env });
    const marked = execFileSync('sh', ['-c', `ls ${home}/.gfv/guard/run-12345678`], {
      encoding: 'utf8',
    });
    expect(marked).toContain('reverted');
  });
  it('an ok file cancels the revert', () => {
    const cmds = guardStartCommands(ufwGuard, 'run-87654321', 'T', { sudo: '' });
    const home = execFileSync('mktemp', ['-d'], { encoding: 'utf8' }).trim();
    const env = { ...process.env, HOME: home };
    execFileSync('sh', ['-c', cmds[0]!], { env });
    execFileSync('sh', ['-c', `touch "$HOME/.gfv/guard/run-87654321/ok"`], { env });
    execFileSync('sh', ['-c', cmds[2]!.replace('sleep 40', 'sleep 0')], { env });
    execFileSync('sh', ['-c', 'sleep 1']);
    const listing = execFileSync('sh', ['-c', `ls ${home}/.gfv/guard/run-87654321`], {
      encoding: 'utf8',
    });
    expect(listing).not.toContain('reverted');
  });
});
