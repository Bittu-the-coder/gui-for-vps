import {
  ConnectResultSchema,
  ListResponseSchema,
  ReadResponseSchema,
  WriteResponseSchema,
  type ListResponse,
  type ReadResponse,
  type WriteResponse,
  HistoryResponseSchema,
  PreviewSchema,
  RunStartedSchema,
  type ActionInfo,
  type HistoryResponse,
  ConnStatusSchema,
  ServerSchema,
  VaultStatusSchema,
  type ConnectResult,
  type Server,
  type VaultStatus,
} from '@gfv/shared';
import { z } from 'zod';

const QueryResultSchema = z.object({
  exitCode: z.number(),
  stdout: z.string(),
  stderr: z.string(),
});
export type QueryResult = z.infer<typeof QueryResultSchema>;
export type RunPreview = z.infer<typeof PreviewSchema>;

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

/** Raw-bytes request (editor save, upload). Same error handling as `request`. */
async function sendBytes(path: string, body: BodyInit): Promise<unknown> {
  const res = await fetch(path, {
    method: 'PUT',
    headers: { 'content-type': 'application/octet-stream' },
    body,
    credentials: 'same-origin',
  });
  const data: unknown = await res.json().catch(() => undefined);
  if (!res.ok) throw new ApiError(res.status, data);
  return data;
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

  actions: async (): Promise<ActionInfo[]> =>
    (await request('GET', '/api/actions')) as ActionInfo[],
  previewRun: async (serverId: string, actionId: string, params: unknown): Promise<RunPreview> =>
    PreviewSchema.parse(await request('POST', '/api/runs/preview', { serverId, actionId, params })),
  startRun: async (serverId: string, actionId: string, params: unknown, confirmed: boolean) =>
    RunStartedSchema.parse(
      await request('POST', '/api/runs', { serverId, actionId, params, confirmed }),
    ).runId,
  history: async (): Promise<HistoryResponse> =>
    HistoryResponseSchema.parse(await request('GET', '/api/history')),

  fsList: async (serverId: string, path: string): Promise<ListResponse> =>
    ListResponseSchema.parse(
      await request('GET', `/api/servers/${serverId}/fs/list?path=${encodeURIComponent(path)}`),
    ),
  fsRead: async (serverId: string, path: string): Promise<ReadResponse> =>
    ReadResponseSchema.parse(
      await request('GET', `/api/servers/${serverId}/fs/read?path=${encodeURIComponent(path)}`),
    ),
  fsSave: async (serverId: string, path: string, text: string): Promise<WriteResponse> =>
    WriteResponseSchema.parse(
      await sendBytes(`/api/servers/${serverId}/fs/file?path=${encodeURIComponent(path)}`, text),
    ),
  fsUpload: async (serverId: string, path: string, file: File): Promise<WriteResponse> =>
    WriteResponseSchema.parse(
      await sendBytes(
        `/api/servers/${serverId}/fs/file?path=${encodeURIComponent(path)}&create=1`,
        file,
      ),
    ),
  fsDownloadUrl: (serverId: string, path: string) =>
    `/api/servers/${serverId}/fs/download?path=${encodeURIComponent(path)}`,

  /** Quiet read-only query (monitor, services, docker). Exit code and output come back as data. */
  query: async (serverId: string, actionId: string, params: unknown = {}): Promise<QueryResult> =>
    QueryResultSchema.parse(
      await request('POST', '/api/runs/query', { serverId, actionId, params }),
    ),

  cancelRun: async (runId: string) => void (await request('POST', `/api/runs/${runId}/cancel`)),
};
