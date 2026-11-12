// Starts server + web together with a shared random session token.
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';

const env = { ...process.env, GFV_TOKEN: randomBytes(32).toString('hex') };
const procs = [
  spawn('npm', ['run', 'dev', '-w', 'server'], { stdio: 'inherit', env }),
  spawn('npm', ['run', 'dev', '-w', 'web'], { stdio: 'inherit', env }),
];
const stop = () => procs.forEach((p) => p.kill());
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
procs.forEach((p) => p.on('exit', stop));
