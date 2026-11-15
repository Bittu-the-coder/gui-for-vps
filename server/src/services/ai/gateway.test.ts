import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildApp } from '../../app.js';
import { testCtx } from '../../testUtil.js';
import { AiGateway, ANTHROPIC_URL } from './gateway.js';

const H = { 'x-gfv-token': 't' };

interface Seen {
  url: string;
  headers: Record<string, string>;
  body: Record<string, unknown>;
}

describe('AI gateway', () => {
  let app: FastifyInstance;
  let ctx: ReturnType<typeof testCtx>;
  const seen: Seen[] = [];
  let reply: { status: number; json: unknown } = { status: 200, json: {} };
  const fakeFetch = (async (url: string, init: RequestInit) => {
    seen.push({
      url,
      headers: init.headers as Record<string, string>,
      body: JSON.parse(String(init.body)),
    });
    return new Response(JSON.stringify(reply.json), {
      status: reply.status,
      headers: { 'content-type': 'application/json' },
    });
  }) as unknown as typeof fetch;

  const call = (method: 'GET' | 'PUT' | 'POST' | 'DELETE', url: string, payload?: object) =>
    app.inject({ method, url, headers: H, payload });
  const answer = (text: string) => ({ content: [{ type: 'text', text }] });
  const settings = (extra: object = {}) =>
    call('PUT', '/api/ai/settings', {
      enabled: true,
      provider: 'anthropic',
      model: 'claude-sonnet-5-5',
      baseUrl: '',
      apiKey: 'sk-ant-test-KEY-1234567890',
      ...extra,
    });

  beforeEach(async () => {
    seen.length = 0;
    reply = { status: 200, json: answer('{"answer":"hello","actions":[]}') };
    ctx = testCtx();
    ctx.ai = new AiGateway(ctx.db, ctx.vault, { fetch: fakeFetch });
    app = await buildApp('t', ctx);
    await app.ready();
    await call('POST', '/api/vault/create', { password: 'master-pass' });
  });
  afterEach(async () => {
    vi.useRealTimers();
    await app.close();
  });

  it('is off by default: nothing can be prepared or sent', async () => {
    expect((await call('GET', '/api/ai/settings')).json()).toMatchObject({
      enabled: false,
      hasKey: false,
    });
    const r = await call('POST', '/api/ai/prepare', { kind: 'ask', text: 'hi' });
    expect(r.statusCode).toBe(409);
    expect(r.json().error).toBe('disabled');
    expect(seen).toHaveLength(0);
  });

  it('stores the key encrypted and never returns it', async () => {
    const r = await settings();
    expect(r.statusCode, r.body).toBe(200);
    expect(r.json()).toMatchObject({
      enabled: true,
      hasKey: true,
      destination: 'api.anthropic.com',
      local: false,
    });
    expect(r.body).not.toContain('sk-ant-test');
    expect((await call('GET', '/api/ai/settings')).body).not.toContain('sk-ant-test');
    const raw = ctx.db.$client.prepare('select api_key from ai_settings').get() as {
      api_key: Buffer;
    };
    expect(raw.api_key.toString('latin1')).not.toContain('sk-ant-test'); // encrypted at rest
    // Saving again without a key keeps the stored one.
    await settings({ apiKey: undefined, model: 'other-model' });
    expect((await call('GET', '/api/ai/settings')).json()).toMatchObject({
      hasKey: true,
      model: 'other-model',
    });
    expect((await call('DELETE', '/api/ai/key')).json().hasKey).toBe(false);
  });

  it('prepare sends NOTHING; send transmits exactly the previewed, scrubbed text, with the right headers', async () => {
    await settings();
    const p = (
      await call('POST', '/api/ai/prepare', {
        kind: 'explain',
        text: 'why does DB_PASSWORD=hunter2 fail?',
      })
    ).json();
    expect(seen).toHaveLength(0); // the preview alone never touches the network
    expect(p.user).not.toContain('hunter2');
    expect(p.scrubbed).toBe(true);
    expect(p.destination).toBe('api.anthropic.com');
    expect(p.system).toContain('You cannot run anything');

    const s = await call('POST', '/api/ai/send', {
      previewId: p.previewId,
      user: 'IGNORED extra field from a hostile client',
      system: 'x',
    });
    expect(s.statusCode, s.body).toBe(200);
    expect(s.json()).toMatchObject({ answer: 'hello', proposals: [] });
    expect(seen).toHaveLength(1);
    expect(seen[0]!.url).toBe(ANTHROPIC_URL);
    expect(seen[0]!.headers['x-api-key']).toBe('sk-ant-test-KEY-1234567890');
    expect(seen[0]!.headers['anthropic-version']).toBe('2023-06-01');
    const sent = seen[0]!.body as {
      model: string;
      system: string;
      messages: { role: string; content: string }[];
    };
    expect(sent.messages[0]!.content).toBe(p.user); // byte for byte what was previewed
    expect(sent.system).toBe(p.system);
    expect(sent.model).toBe('claude-sonnet-5-5');
    expect(JSON.stringify(seen[0]!.body)).not.toContain('hunter2');
    expect(s.body).not.toContain('sk-ant-test');
  });

  it('a preview is single-use, unknown ids send nothing, and old previews expire', async () => {
    await settings();
    const p = (await call('POST', '/api/ai/prepare', { kind: 'ask', text: 'q' })).json();
    expect((await call('POST', '/api/ai/send', { previewId: p.previewId })).statusCode).toBe(200);
    expect((await call('POST', '/api/ai/send', { previewId: p.previewId })).statusCode).toBe(410);
    expect(
      (await call('POST', '/api/ai/send', { previewId: 'not-a-real-preview-id' })).statusCode,
    ).toBe(410);
    const old = (await call('POST', '/api/ai/prepare', { kind: 'ask', text: 'q2' })).json();
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(Date.now() + 6 * 60_000);
    expect((await call('POST', '/api/ai/send', { previewId: old.previewId })).statusCode).toBe(410);
    expect(seen).toHaveLength(1);
  });

  it('turning the assistant off after a preview stops the send', async () => {
    await settings();
    const p = (await call('POST', '/api/ai/prepare', { kind: 'ask', text: 'q' })).json();
    await settings({ enabled: false });
    const r = await call('POST', '/api/ai/send', { previewId: p.previewId });
    expect(r.statusCode).toBe(409);
    expect(seen).toHaveLength(0);
  });

  it('proposals are checked against the real action catalog, and show the real risk', async () => {
    await settings();
    reply = {
      status: 200,
      json: answer(
        JSON.stringify({
          answer: 'Open 8080.',
          actions: [
            {
              actionId: 'firewall.allow',
              params: { policy: 'allow', port: '8080' },
              why: 'for your app',
            },
            { actionId: 'made.up', params: {}, why: '' },
            { actionId: 'firewall.allow', params: { policy: 'allow', port: '1; reboot' }, why: '' },
          ],
        }),
      ),
    };
    const p = (
      await call('POST', '/api/ai/prepare', { kind: 'ask', text: 'open port 8080' })
    ).json();
    const s = (await call('POST', '/api/ai/send', { previewId: p.previewId })).json();
    expect(s.proposals).toHaveLength(1);
    expect(s.proposals[0]).toMatchObject({ actionId: 'firewall.allow', risk: 'caution' });
    expect(s.rejected).toBe(2);
  });

  it('provider failures are explained and never echo the key', async () => {
    await settings();
    reply = { status: 401, json: { error: { message: 'invalid x-api-key' } } };
    const p = (await call('POST', '/api/ai/prepare', { kind: 'ask', text: 'q' })).json();
    const r = await call('POST', '/api/ai/send', { previewId: p.previewId });
    expect(r.statusCode).toBe(502);
    expect(r.json().message).toContain('invalid x-api-key');
    expect(r.body).not.toContain('sk-ant-test');
  });

  it('the key survives a change of master password', async () => {
    await settings();
    expect(
      (
        await call('POST', '/api/vault/change-password', {
          oldPassword: 'master-pass',
          newPassword: 'new-master-pass',
        })
      ).statusCode,
    ).toBe(200);
    const p = (await call('POST', '/api/ai/prepare', { kind: 'ask', text: 'q' })).json();
    expect((await call('POST', '/api/ai/send', { previewId: p.previewId })).statusCode).toBe(200);
    expect(seen[0]!.headers['x-api-key']).toBe('sk-ant-test-KEY-1234567890');
  });

  it('anthropic needs a key; invalid input is a 400', async () => {
    await settings({ apiKey: undefined });
    expect((await call('POST', '/api/ai/prepare', { kind: 'ask', text: 'q' })).json().error).toBe(
      'no_key',
    );
    await settings();
    expect((await call('POST', '/api/ai/prepare', { kind: 'ask', text: '   ' })).statusCode).toBe(
      400,
    );
    expect(
      (
        await call('PUT', '/api/ai/settings', {
          enabled: true,
          provider: 'anthropic',
          model: '',
          baseUrl: '',
        })
      ).statusCode,
    ).toBe(400);
    expect(
      (
        await call('PUT', '/api/ai/settings', {
          enabled: true,
          provider: 'openai-compatible',
          model: 'm',
          baseUrl: 'file:///etc/passwd',
        })
      ).statusCode,
    ).toBe(400);
  });
});

describe('OpenAI-compatible endpoint (a real local HTTP server, like Ollama)', () => {
  let app: FastifyInstance;
  let model: Server;
  let url = '';
  const requests: {
    path: string;
    auth?: string;
    body: { model: string; messages: { role: string; content: string }[] };
  }[] = [];
  const call = (method: 'GET' | 'PUT' | 'POST', u: string, payload?: object) =>
    app.inject({ method, url: u, headers: H, payload });

  beforeEach(async () => {
    requests.length = 0;
    model = createServer((req: IncomingMessage, res) => {
      let data = '';
      req.on('data', (d) => (data += d));
      req.on('end', () => {
        requests.push({
          path: req.url ?? '',
          auth: req.headers.authorization,
          body: JSON.parse(data),
        });
        res.setHeader('content-type', 'application/json');
        res.end(
          JSON.stringify({
            choices: [{ message: { content: '{"answer":"local answer","actions":[]}' } }],
          }),
        );
      });
    });
    await new Promise<void>((r) => model.listen(0, '127.0.0.1', r));
    url = `http://127.0.0.1:${(model.address() as AddressInfo).port}/v1`;
    const ctx = testCtx();
    app = await buildApp('t', ctx);
    await app.ready();
    await call('POST', '/api/vault/create', { password: 'master-pass' });
  });
  afterEach(async () => {
    await app.close();
    await new Promise((r) => model.close(r));
  });

  it('works without a key, says it stays on this computer, and sends the standard chat request', async () => {
    const s = await call('PUT', '/api/ai/settings', {
      enabled: true,
      provider: 'openai-compatible',
      model: 'llama3.2',
      baseUrl: url,
    });
    expect(s.json()).toMatchObject({ local: true, hasKey: false });
    expect(s.json().destination).toMatch(/^127\.0\.0\.1:\d+$/);
    const p = (
      await call('POST', '/api/ai/prepare', { kind: 'ask', text: 'how do I see disk usage?' })
    ).json();
    expect(p.local).toBe(true);
    expect(requests).toHaveLength(0);
    const r = await call('POST', '/api/ai/send', { previewId: p.previewId });
    expect(r.json().answer).toBe('local answer');
    expect(requests).toHaveLength(1);
    expect(requests[0]!.path).toBe('/v1/chat/completions');
    expect(requests[0]!.auth).toBeUndefined();
    expect(requests[0]!.body.model).toBe('llama3.2');
    expect(requests[0]!.body.messages.map((m) => m.role)).toEqual(['system', 'user']);
    expect(requests[0]!.body.messages[1]!.content).toBe(p.user);
  });

  it('sends a bearer key when one is set, and an unreachable server is explained', async () => {
    await call('PUT', '/api/ai/settings', {
      enabled: true,
      provider: 'openai-compatible',
      model: 'm',
      baseUrl: url,
      apiKey: 'local-key-123',
    });
    const p = (await call('POST', '/api/ai/prepare', { kind: 'ask', text: 'q' })).json();
    await call('POST', '/api/ai/send', { previewId: p.previewId });
    expect(requests[0]!.auth).toBe('Bearer local-key-123');
    await call('PUT', '/api/ai/settings', {
      enabled: true,
      provider: 'openai-compatible',
      model: 'm',
      baseUrl: 'http://127.0.0.1:1/v1',
    });
    const p2 = (await call('POST', '/api/ai/prepare', { kind: 'ask', text: 'q' })).json();
    const r = await call('POST', '/api/ai/send', { previewId: p2.previewId });
    expect(r.statusCode).toBe(502);
    expect(r.json().message).toContain('Could not reach');
  });
});
