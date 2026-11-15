import {
  ConnectResultSchema,
  JobSnapshotSchema,
  PlanSchema,
  type JobCreateBody,
  type JobDecision,
  type JobPlanBody,
  type JobSnapshot,
  type Plan,
  type RecipeParam,
  RecipeDetailSchema,
  RecipeSchema,
  RecordingStateSchema,
  type RecipeDetail,
  type Recipe,
  type RecordingState,
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
  type ExportFormat,
  type DescribedStep,
  type RecipeFile,
  type HistoryResponse,
  ConnStatusSchema,
  publicConnectionSchema,
  type ConnectionInput,
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
const SnapshotSchema = z.object({
  id: z.string(),
  serverId: z.string(),
  path: z.string(),
  remotePath: z.string(),
  sizeBytes: z.number(),
  createdAt: z.number(),
  source: z.string().nullable(),
  runId: z.string().nullable(),
});
export type SnapshotRow = z.infer<typeof SnapshotSchema>;
export type RunPreview = z.infer<typeof PreviewSchema>;
const RecipeExportSchema = z.object({
  script: z.string(),
  filename: z.string(),
  files: z.array(z.object({ name: z.string(), content: z.string() })),
  notes: z.array(z.string()),
});
export type RecipeExport = z.infer<typeof RecipeExportSchema>;
const LibraryEntrySchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  tags: z.array(z.string()),
  author: z.string(),
  risk: z.enum(['safe', 'caution', 'danger']),
  steps: z.array(z.custom<DescribedStep>()),
});
export type LibraryEntry = z.infer<typeof LibraryEntrySchema>;

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
      message?: string;
      issues?: { path: (string | number)[]; message: string }[];
    };
    if (b?.issues?.length)
      return b.issues.map((i) => `${i.path.join('.') || 'value'}: ${i.message}`).join('\n');
    return b?.message ?? b?.error ?? `request failed (${this.status})`;
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

const DbConnections = z.array(publicConnectionSchema);
const DbTables = z.array(
  z.object({ schema: z.string(), name: z.string(), kind: z.enum(['table', 'view']) }),
);
const DbColumns = z.array(z.object({ name: z.string(), type: z.string(), nullable: z.boolean() }));
const DbResult = z.object({
  columns: z.array(z.string()),
  rows: z.array(z.array(z.string().nullable())),
  truncated: z.boolean(),
  command: z.string(),
  rowCount: z.number().nullable(),
  ms: z.number(),
});

const AiSettings = z.object({
  enabled: z.boolean(),
  provider: z.enum(['anthropic', 'openai-compatible']),
  model: z.string(),
  baseUrl: z.string(),
  hasKey: z.boolean(),
  destination: z.string(),
  local: z.boolean(),
});
export type AiSettings = z.infer<typeof AiSettings>;
const AiPrepared = z.object({
  previewId: z.string(),
  system: z.string(),
  user: z.string(),
  scrubbed: z.boolean(),
  destination: z.string(),
  local: z.boolean(),
  model: z.string(),
  expiresAt: z.number(),
});
export type AiPrepared = z.infer<typeof AiPrepared>;
const AiAnswerSchema = z.object({
  answer: z.string(),
  proposals: z.array(
    z.object({
      actionId: z.string(),
      title: z.string(),
      params: z.unknown(),
      why: z.string(),
      risk: z.enum(['safe', 'caution', 'danger']),
    }),
  ),
  rejected: z.number(),
});
export type AiAnswerData = z.infer<typeof AiAnswerSchema>;

const AuthStatusParsed = z.object({
  hosted: z.boolean(),
  setupNeeded: z.boolean(),
  user: z
    .object({
      id: z.string(),
      username: z.string(),
      role: z.enum(['admin', 'member']),
      totpEnabled: z.boolean(),
    })
    .nullable(),
});
const UserRows = z.array(
  z.object({
    id: z.string(),
    username: z.string(),
    role: z.enum(['admin', 'member']),
    totpEnabled: z.boolean(),
    disabled: z.boolean(),
    createdAt: z.number(),
    lastLoginAt: z.number().nullable(),
    serverIds: z.array(z.string()),
  }),
);
const AuditRows = z.array(
  z.object({
    id: z.number(),
    at: z.number(),
    userId: z.string().nullable(),
    username: z.string().nullable(),
    ip: z.string().nullable(),
    event: z.string(),
    serverId: z.string().nullable(),
    ok: z.boolean(),
    detail: z.string().nullable(),
  }),
);
const SessionRows = z.array(
  z.object({
    id: z.string(),
    createdAt: z.number(),
    lastSeen: z.number(),
    ip: z.string().nullable(),
    userAgent: z.string().nullable(),
    current: z.boolean(),
  }),
);

export const api = {
  // ---- Accounts (hosted mode, M24)
  authStatus: async () => AuthStatusParsed.parse(await request('GET', '/api/auth/status')),
  authSetup: async (b: { setupToken: string; username: string; password: string }) =>
    void (await request('POST', '/api/auth/setup', b)),
  authLogin: async (b: { username: string; password: string; code?: string }) =>
    void (await request('POST', '/api/auth/login', b)),
  authLogout: async () => void (await request('POST', '/api/auth/logout')),
  authPassword: async (oldPassword: string, newPassword: string) =>
    void (await request('POST', '/api/auth/password', { oldPassword, newPassword })),
  twoFaBegin: async () =>
    z
      .object({ secret: z.string(), otpauth: z.string() })
      .parse(await request('POST', '/api/auth/2fa/begin')),
  twoFaConfirm: async (code: string) =>
    z
      .object({ recoveryCodes: z.array(z.string()) })
      .parse(await request('POST', '/api/auth/2fa/confirm', { code })),
  twoFaDisable: async (password: string) =>
    void (await request('POST', '/api/auth/2fa/disable', { password })),
  mySessions: async () => SessionRows.parse(await request('GET', '/api/auth/sessions')),
  revokeSession: async (id: string) => void (await request('DELETE', `/api/auth/sessions/${id}`)),
  users: async () => UserRows.parse(await request('GET', '/api/users')),
  createUser: async (b: { username: string; password: string; role: 'admin' | 'member' }) =>
    void (await request('POST', '/api/users', b)),
  updateUser: async (id: string, b: { role?: 'admin' | 'member'; disabled?: boolean }) =>
    void (await request('PATCH', `/api/users/${id}`, b)),
  deleteUser: async (id: string) => void (await request('DELETE', `/api/users/${id}`)),
  resetUserPassword: async (id: string, password: string) =>
    void (await request('POST', `/api/users/${id}/password`, { password })),
  resetUser2fa: async (id: string) => void (await request('POST', `/api/users/${id}/reset-2fa`)),
  setUserAccess: async (id: string, serverIds: string[]) =>
    void (await request('PUT', `/api/users/${id}/access`, { serverIds })),
  audit: async (limit = 200) => AuditRows.parse(await request('GET', `/api/audit?limit=${limit}`)),

  // ---- Assistant (M23)
  aiSettings: async () => AiSettings.parse(await request('GET', '/api/ai/settings')),
  aiSave: async (input: {
    enabled: boolean;
    provider: string;
    model: string;
    baseUrl: string;
    apiKey?: string;
  }) => AiSettings.parse(await request('PUT', '/api/ai/settings', input)),
  aiForgetKey: async () => AiSettings.parse(await request('DELETE', '/api/ai/key')),
  aiPrepare: async (input: {
    kind: 'ask' | 'explain';
    text: string;
    context?: { history?: string[] };
  }) => AiPrepared.parse(await request('POST', '/api/ai/prepare', input)),
  aiSend: async (previewId: string) =>
    AiAnswerSchema.parse(await request('POST', '/api/ai/send', { previewId })),

  // ---- Database app (M21)
  dbList: async (serverId: string) =>
    DbConnections.parse(await request('GET', `/api/servers/${serverId}/db`)),
  dbCreate: async (serverId: string, input: ConnectionInput) =>
    publicConnectionSchema.parse(await request('POST', `/api/servers/${serverId}/db`, input)),
  dbRemove: async (connId: string) => void (await request('DELETE', `/api/db/${connId}`)),
  dbTables: async (connId: string) =>
    DbTables.parse(await request('GET', `/api/db/${connId}/tables`)),
  dbColumns: async (connId: string, schema: string, table: string) =>
    DbColumns.parse(await request('POST', `/api/db/${connId}/columns`, { schema, table })),
  dbPreview: async (connId: string, schema: string, table: string) =>
    DbResult.parse(await request('POST', `/api/db/${connId}/preview`, { schema, table })),
  dbQuery: async (connId: string, sql: string, write = false, confirmed = false) =>
    DbResult.parse(await request('POST', `/api/db/${connId}/query`, { sql, write, confirmed })),

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
  /** Copy a file between servers (streamed through GFV). Never overwrites. */
  transfer: async (
    from: { serverId: string; path: string },
    to: { serverId: string; path: string },
  ) => z.object({ size: z.number() }).parse(await request('POST', '/api/transfer', { from, to })),
  fsDownloadUrl: (serverId: string, path: string) =>
    `/api/servers/${serverId}/fs/download?path=${encodeURIComponent(path)}`,

  /** Quiet read-only query (monitor, services, docker). Exit code and output come back as data. */
  query: async (serverId: string, actionId: string, params: unknown = {}): Promise<QueryResult> =>
    QueryResultSchema.parse(
      await request('POST', '/api/runs/query', { serverId, actionId, params }),
    ),

  cancelRun: async (runId: string) => void (await request('POST', `/api/runs/${runId}/cancel`)),

  snapshots: async (serverId: string): Promise<SnapshotRow[]> =>
    z.array(SnapshotSchema).parse(await request('GET', `/api/servers/${serverId}/snapshots`)),

  recipes: async (): Promise<Recipe[]> =>
    z.array(RecipeSchema).parse(await request('GET', '/api/recipes')),
  recipe: async (id: string): Promise<RecipeDetail> =>
    RecipeDetailSchema.parse(await request('GET', `/api/recipes/${id}`)),
  renameRecipe: async (id: string, name: string) =>
    void (await request('PATCH', `/api/recipes/${id}`, { name })),
  deleteRecipe: async (id: string) => void (await request('DELETE', `/api/recipes/${id}`)),
  reorderSteps: async (id: string, order: string[]) =>
    void (await request('POST', `/api/recipes/${id}/steps/reorder`, { order })),
  deleteStep: async (id: string, stepId: string) =>
    void (await request('DELETE', `/api/recipes/${id}/steps/${stepId}`)),
  exportRecipe: async (id: string, format: ExportFormat = 'bash'): Promise<RecipeExport> =>
    RecipeExportSchema.parse(await request('GET', `/api/recipes/${id}/export?format=${format}`)),
  library: async (): Promise<LibraryEntry[]> =>
    z.array(LibraryEntrySchema).parse(await request('GET', '/api/library')),
  importLibraryRecipe: async (id: string): Promise<{ recipeId: string }> =>
    z.object({ recipeId: z.string() }).parse(await request('POST', `/api/library/${id}/import`)),
  importRecipeFile: async (file: unknown): Promise<{ recipeId: string }> =>
    z
      .object({ recipeId: z.string() })
      .parse(await request('POST', '/api/recipes/import', { file })),
  recipeFile: async (id: string): Promise<RecipeFile> =>
    (await request('GET', `/api/recipes/${id}/file`)) as RecipeFile,
  cloneServer: async (serverId: string): Promise<{ recipeId: string; tools: string[] }> =>
    z
      .object({ recipeId: z.string(), tools: z.array(z.string()) })
      .parse(await request('POST', `/api/servers/${serverId}/clone-recipe`)),
  setRecipeParams: async (id: string, params: RecipeParam[]) =>
    void (await request('PUT', `/api/recipes/${id}/params`, { params })),
  updateStep: async (id: string, stepId: string, params: unknown) =>
    void (await request('PATCH', `/api/recipes/${id}/steps/${stepId}`, { params })),

  jobPlan: async (body: JobPlanBody): Promise<Plan> =>
    PlanSchema.parse(await request('POST', '/api/jobs/plan', body)),
  createJob: async (body: JobCreateBody): Promise<JobSnapshot> =>
    JobSnapshotSchema.parse(await request('POST', '/api/jobs', body)),
  jobs: async (): Promise<JobSnapshot[]> =>
    z.array(JobSnapshotSchema).parse(await request('GET', '/api/jobs')),
  cancelJob: async (id: string) => void (await request('POST', `/api/jobs/${id}/cancel`)),
  decideJob: async (id: string, serverId: string, decision: JobDecision) =>
    void (await request('POST', `/api/jobs/${id}/targets/${serverId}/decision`, { decision })),
  deleteJob: async (id: string) => void (await request('DELETE', `/api/jobs/${id}`)),
  recording: async (): Promise<RecordingState> =>
    RecordingStateSchema.parse(await request('GET', '/api/recording')),
  startRecording: async (serverId: string) =>
    void (await request('POST', '/api/recording/start', { serverId })),
  stopRecording: async (): Promise<{ recipeId: string }> =>
    z.object({ recipeId: z.string() }).parse(await request('POST', '/api/recording/stop')),

  changePassword: async (oldPassword: string, newPassword: string) =>
    void (await request('POST', '/api/vault/change-password', { oldPassword, newPassword })),

  deleteSnapshot: async (serverId: string, snapshotId: string) =>
    void (await request('DELETE', `/api/servers/${serverId}/snapshots/${snapshotId}`)),
};
