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
      finish({ status: 'error', message: err.message });
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
