import { Client } from 'ssh2';
import { fingerprint, keyTypeOf, type HostKeyStore } from './hostKeys.js';

export interface Target {
  id: string;
  host: string;
  port: number;
  username: string;
  secret: { privateKey?: string; passphrase?: string; password?: string };
}

export type ConnectOutcome =
  | { status: 'connected'; client: Client }
  | { status: 'host_key_unknown'; keyType: string; fingerprint: string }
  | { status: 'host_key_changed'; keyType: string; fingerprint: string; expected: string }
  | { status: 'auth_failed' }
  | { status: 'error'; message: string };

/**
 * ssh2's own messages ("Timed out while waiting for handshake") say what failed but not what to do about it.
 * This turns the common network failures into a sentence that tells a beginner where to look. Anything it does not
 * recognise keeps its original text.
 */
export function friendlyConnectError(message: string, host: string, port: number): string {
  const where = `${host}:${port}`;
  if (/timed out|ETIMEDOUT/i.test(message))
    return `Could not reach ${where}. Check that the server is running, that the address and port are right, and that its firewall or cloud network rules (for example a security group) allow SSH from your address.`;
  if (/ECONNREFUSED/i.test(message))
    return `${where} refused the connection. Nothing is listening for SSH there: check that the SSH service is running and that the port is right.`;
  if (/ENOTFOUND|EAI_AGAIN/i.test(message))
    return `Could not find "${host}". Check the address for typos, and that your computer can reach the internet.`;
  if (/EHOSTUNREACH|ENETUNREACH/i.test(message))
    return `There is no route to ${where} from this computer. Check the address and your network connection.`;
  return message;
}

/**
 * Opens one SSH connection with Trust-On-First-Use host-key checking:
 *  - key matches the stored one  -> continue
 *  - no stored key               -> ABORT and report it, so the user can approve
 *  - stored key differs          -> ABORT and report it. Never auto-accepted.
 * Secrets are only read here and never logged or included in error messages.
 */
export function connect(target: Target, hostKeys: HostKeyStore): Promise<ConnectOutcome> {
  return new Promise((resolve) => {
    const client = new Client();
    let hostKeyProblem: Extract<ConnectOutcome, { status: `host_key_${string}` }> | undefined;
    let done = false;
    const finish = (o: ConnectOutcome) => {
      if (done) return;
      done = true;
      if (o.status !== 'connected') client.end();
      resolve(o);
    };

    client.on('ready', () => finish({ status: 'connected', client }));
    client.on('error', (err: Error & { level?: string }) => {
      if (hostKeyProblem) return finish(hostKeyProblem);
      if (err.level === 'client-authentication') return finish({ status: 'auth_failed' });
      finish({
        status: 'error',
        message: friendlyConnectError(err.message, target.host, target.port),
      });
    });
    client.on('close', () =>
      finish(hostKeyProblem ?? { status: 'error', message: 'connection closed' }),
    );

    try {
      client.connect({
        host: target.host,
        port: target.port,
        username: target.username,
        ...target.secret,
        readyTimeout: 10_000,
        keepaliveInterval: 15_000,
        keepaliveCountMax: 3,
        hostVerifier: (key: Buffer) => {
          const fp = fingerprint(key);
          const keyType = keyTypeOf(key);
          const stored = hostKeys.get(target.id);
          if (!stored) {
            hostKeyProblem = { status: 'host_key_unknown', keyType, fingerprint: fp };
            return false;
          }
          if (stored.fingerprint !== fp) {
            hostKeyProblem = {
              status: 'host_key_changed',
              keyType,
              fingerprint: fp,
              expected: stored.fingerprint,
            };
            return false;
          }
          return true;
        },
      });
    } catch (e) {
      finish({ status: 'error', message: e instanceof Error ? e.message : 'connect failed' });
    }
  });
}
