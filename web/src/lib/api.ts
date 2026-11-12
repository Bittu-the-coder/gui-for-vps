import {
  ConnectResultSchema,
  ConnStatusSchema,
  ServerSchema,
  VaultStatusSchema,
  type ConnectResult,
  type Server,
  type VaultStatus,
} from '@gfv/shared';
import { z } from 'zod';

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly body: unknown,
  ) {
    super(`API error ${status}`);
  }

  /** Human-readable text, including Zod validation issues from the server. */
  get detail(): string {
    const b = this.body as {
      error?: string;
      issues?: { path: (string | number)[]; message: string }[];
    };
    if (b?.issues?.length)
      return b.issues.map((i) => `${i.path.join('.') || 'value'}: ${i.message}`).join('\n');
    return b?.error ?? `request failed (${this.status})`;
  }
}

async function request(method: string, path: string, body?: unknown): Promise<unknown> {
  const res = await fetch(path, {
    method,
    headers: body === undefined ? undefined : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
    credentials: 'same-origin',
  });
  if (res.status === 204) return undefined;
  const data: unknown = await res.json().catch(() => undefined);
  if (!res.ok) throw new ApiError(res.status, data);
  return data;
}

const Servers = z.array(ServerSchema);
const Statuses = z.record(z.string(), ConnStatusSchema);

export const api = {
  vault: async (): Promise<VaultStatus> =>
    VaultStatusSchema.parse(await request('GET', '/api/vault')),
  createVault: async (password: string) =>
    VaultStatusSchema.parse(await request('POST', '/api/vault/create', { password })),
  unlock: async (password: string) =>
    VaultStatusSchema.parse(await request('POST', '/api/vault/unlock', { password })),
  lock: async () => VaultStatusSchema.parse(await request('POST', '/api/vault/lock')),

  servers: async (): Promise<Server[]> => Servers.parse(await request('GET', '/api/servers')),
  createServer: async (body: object): Promise<Server> =>
    ServerSchema.parse(await request('POST', '/api/servers', body)),
  updateServer: async (id: string, body: object): Promise<Server> =>
    ServerSchema.parse(await request('PUT', `/api/servers/${id}`, body)),
  deleteServer: async (id: string) => void (await request('DELETE', `/api/servers/${id}`)),

  connections: async () => Statuses.parse(await request('GET', '/api/connections')),
  connect: async (id: string): Promise<ConnectResult> =>
    ConnectResultSchema.parse(await request('POST', `/api/servers/${id}/connect`)),
  test: async (id: string): Promise<ConnectResult> =>
    ConnectResultSchema.parse(await request('POST', `/api/servers/${id}/test`)),
  disconnect: async (id: string) => void (await request('POST', `/api/servers/${id}/disconnect`)),
  trustHostKey: async (id: string, fingerprint: string, replace = false) =>
    void (await request('POST', `/api/servers/${id}/trust-host-key`, { fingerprint, replace })),
};
