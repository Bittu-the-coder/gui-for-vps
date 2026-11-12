import type { Client } from 'ssh2';

/**
 * EXCEPTION to the "everything goes through the Command Runner" rule:
 * the runner doesn't exist until M4, and the "Test connection" button needs a
 * tiny fixed command (`echo ok`). Do not use this for anything user-driven.
 */
export function execOnce(
  client: Client,
  command: string,
): Promise<{ stdout: string; code: number }> {
  return new Promise((resolve, reject) => {
    client.exec(command, (err, stream) => {
      if (err) return reject(err);
      let stdout = '';
      stream.on('data', (d: Buffer) => (stdout += d.toString()));
      stream.stderr.on('data', () => {});
      stream.on('close', (code: number | null) => resolve({ stdout, code: code ?? -1 }));
    });
  });
}
