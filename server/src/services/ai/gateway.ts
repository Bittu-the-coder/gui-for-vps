import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import {
  aiRequestSchema,
  buildRequest,
  destinationOf,
  parseAnswer,
  type AiAnswer,
  type AiRequest,
  type AiSettingsInput,
  type AiSettingsPublic,
  type BuiltRequest,
} from '@gfv/shared';
import type { Vault } from '../../crypto/vault.js';
import type { Db } from '../../db/index.js';
import { aiSettings } from '../../db/schema.js';

export class AiError extends Error {
  constructor(
    readonly code: 'disabled' | 'no_key' | 'no_preview' | 'provider' | 'not_configured',
    message: string,
  ) {
    super(message);
  }
}

export interface PreparedSend {
  previewId: string;
  system: string;
  user: string;
  scrubbed: boolean;
  destination: string;
  local: boolean;
  model: string;
  expiresAt: number;
}

const PREVIEW_TTL_MS = 5 * 60_000;
const SEND_TIMEOUT_MS = 90_000;
export const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';

/**
 * THE gateway: the only code in GFV that talks to a language model. It never sends anything on its own. A send is
 * two steps: `prepare` builds and scrubs the exact text and returns it for the person to read; `send` then transmits
 * exactly that stored text, once. There is no other way to reach the network from here.
 */
export class AiGateway {
  private previews = new Map<string, { built: BuiltRequest; expiresAt: number }>();

  constructor(
    private db: Db,
    private vault: Vault,
    private opts: { fetch?: typeof fetch; anthropicUrl?: string } = {},
  ) {}

  private row() {
    return this.db.select().from(aiSettings).where(eq(aiSettings.id, 1)).get();
  }

  settings(): AiSettingsPublic {
    const r = this.row();
    const base = {
      enabled: r?.enabled ?? false,
      provider: r?.provider ?? ('anthropic' as const),
      model: r?.model ?? 'claude-sonnet-5-5',
      baseUrl: r?.baseUrl ?? '',
    };
    return { ...base, hasKey: !!r?.apiKey, ...destinationOf(base) };
  }

  save(input: AiSettingsInput): AiSettingsPublic {
    const cur = this.row();
    const apiKey = input.apiKey ? this.vault.encrypt(input.apiKey) : (cur?.apiKey ?? null);
    const values = {
      id: 1,
      enabled: input.enabled,
      provider: input.provider,
      model: input.model,
      baseUrl: input.baseUrl,
      apiKey,
    };
    this.db
      .insert(aiSettings)
      .values(values)
      .onConflictDoUpdate({ target: aiSettings.id, set: values })
      .run();
    return this.settings();
  }

  /** Removes the stored key (the settings stay). */
  forgetKey(): void {
    this.db.update(aiSettings).set({ apiKey: null }).where(eq(aiSettings.id, 1)).run();
  }

  prepare(raw: unknown): PreparedSend {
    const s = this.settings();
    if (!s.enabled)
      throw new AiError(
        'disabled',
        'The assistant is turned off. Turn it on in its settings first.',
      );
    if (s.provider === 'anthropic' && !s.hasKey)
      throw new AiError('no_key', 'Add your Anthropic API key in the settings first.');
    if (s.provider === 'openai-compatible' && !s.baseUrl)
      throw new AiError('not_configured', 'Set the address of your model server first.');
    const req: AiRequest = aiRequestSchema.parse(raw);
    const built = buildRequest(req);
    const previewId = randomUUID();
    const expiresAt = Date.now() + PREVIEW_TTL_MS;
    this.sweep();
    this.previews.set(previewId, { built, expiresAt });
    return {
      previewId,
      system: built.system,
      user: built.user,
      scrubbed: built.scrubbed,
      destination: s.destination,
      local: s.local,
      model: s.model,
      expiresAt,
    };
  }

  private sweep() {
    const now = Date.now();
    for (const [id, p] of this.previews) if (p.expiresAt < now) this.previews.delete(id);
  }

  /** Sends EXACTLY the previewed text, once. An unknown, used or expired preview id sends nothing. */
  async send(previewId: string): Promise<AiAnswer> {
    this.sweep();
    const p = this.previews.get(previewId);
    if (!p)
      throw new AiError('no_preview', 'That preview expired or was already used. Preview again.');
    this.previews.delete(previewId); // one send per preview
    const r = this.row();
    if (!r?.enabled) throw new AiError('disabled', 'The assistant is turned off.');
    const key = r.apiKey ? this.vault.decrypt(r.apiKey) : '';
    const text =
      r.provider === 'anthropic'
        ? await this.anthropic(r.model, key, p.built)
        : await this.compatible(r.baseUrl, r.model, key, p.built);
    return parseAnswer(text);
  }

  private async post(
    url: string,
    headers: Record<string, string>,
    body: unknown,
  ): Promise<unknown> {
    const f = this.opts.fetch ?? fetch;
    let res: Response;
    try {
      res = await f(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...headers },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
      });
    } catch (e) {
      throw new AiError(
        'provider',
        `Could not reach the model (${e instanceof Error ? e.message : 'network error'}).`,
      );
    }
    const data: unknown = await res.json().catch(() => undefined);
    if (!res.ok) {
      const msg = (data as { error?: { message?: string } | string })?.error;
      const text = typeof msg === 'string' ? msg : (msg?.message ?? `HTTP ${res.status}`);
      throw new AiError('provider', `The model service said: ${text}`.slice(0, 300));
    }
    return data;
  }

  private async anthropic(model: string, key: string, b: BuiltRequest): Promise<string> {
    const data = (await this.post(
      this.opts.anthropicUrl ?? ANTHROPIC_URL,
      { 'x-api-key': key, 'anthropic-version': '2023-06-01' },
      { model, max_tokens: 1500, system: b.system, messages: [{ role: 'user', content: b.user }] },
    )) as { content?: { type: string; text?: string }[] };
    const text = (data.content ?? [])
      .filter((c) => c.type === 'text')
      .map((c) => c.text ?? '')
      .join('');
    if (!text) throw new AiError('provider', 'The model returned an empty answer.');
    return text;
  }

  private async compatible(
    baseUrl: string,
    model: string,
    key: string,
    b: BuiltRequest,
  ): Promise<string> {
    const data = (await this.post(
      `${baseUrl.replace(/\/+$/, '')}/chat/completions`,
      key ? { authorization: `Bearer ${key}` } : {},
      {
        model,
        temperature: 0.2,
        stream: false,
        messages: [
          { role: 'system', content: b.system },
          { role: 'user', content: b.user },
        ],
      },
    )) as { choices?: { message?: { content?: string } }[] };
    const text = data.choices?.[0]?.message?.content;
    if (!text) throw new AiError('provider', 'The model returned an empty answer.');
    return text;
  }
}
