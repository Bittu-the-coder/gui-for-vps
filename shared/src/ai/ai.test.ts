import { describe, expect, it } from 'vitest';
import {
  actionCatalog,
  aiRequestSchema,
  buildRequest,
  destinationOf,
  parseAnswer,
  SYSTEM_PROMPT,
} from './assistant.js';
import { hadSecrets, scrubSecrets } from './scrub.js';

describe('scrubbing secrets', () => {
  it.each([
    ['DB_PASSWORD=hunter2 npm start', 'hunter2'],
    ['password: "correct horse battery"', 'correct horse'],
    ['export API_KEY=abcd1234efgh', 'abcd1234efgh'],
    ['mysql --password=s3cret -u root', 's3cret'],
    ['curl -H "Authorization: Bearer abc.def.ghi" https://x', 'abc.def.ghi'],
    ['postgres://admin:p4ss@db.example.com/app', 'p4ss'],
    ['token sk-ant-api03-AAAAAAAAAAAAAAAAAAAAAAAA', 'sk-ant-api03'],
    ['key ghp_abcdefghijklmnopqrstuvwxyz0123456789', 'ghp_abcdef'],
    ['AKIAABCDEFGHIJKLMNOP', 'AKIAABCDEFGHIJKLMNOP'],
    ['eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0In0.abcdefghijklmnop', 'eyJhbGci'],
    ['-----BEGIN OPENSSH PRIVATE KEY-----\nAAAA\nBBBB\n-----END OPENSSH PRIVATE KEY-----', 'AAAA'],
  ])('removes the secret in %j', (input, secret) => {
    const out = scrubSecrets(input);
    expect(out).not.toContain(secret);
    expect(hadSecrets(input)).toBe(true);
  });
  it('leaves ordinary text alone', () => {
    const t = 'nginx -t failed: unknown directive "listn" in /etc/nginx/sites-enabled/app:3';
    expect(scrubSecrets(t)).toBe(t);
    expect(hadSecrets(t)).toBe(false);
  });
});

describe('building a request', () => {
  it('scrubs what the person typed and says so', () => {
    const b = buildRequest(
      aiRequestSchema.parse({
        kind: 'explain',
        text: 'why does DB_PASSWORD=abc123 not work in this line?',
      }),
    );
    expect(b.user).not.toContain('abc123');
    expect(b.scrubbed).toBe(true);
    expect(b.user).toContain('Explain this');
  });
  it('adds context only when it was ticked', () => {
    const plain = buildRequest(
      aiRequestSchema.parse({ kind: 'ask', text: 'how do I restart nginx?' }),
    );
    expect(plain.user).not.toContain('Ubuntu');
    expect(plain.user).not.toContain('recent commands');
    const rich = buildRequest(
      aiRequestSchema.parse({
        kind: 'ask',
        text: 'q',
        context: { os: 'Ubuntu 24.04', history: ['uptime'] },
      }),
    );
    expect(rich.user).toContain('Ubuntu 24.04');
    expect(rich.user).toContain('uptime');
  });
  it('the catalog in the system prompt lists real, non-quiet actions only, with their risk', () => {
    const c = actionCatalog();
    expect(c).toContain('firewall.allow [caution]');
    expect(c).toContain('apps.install');
    expect(c).not.toContain('firewall.status');
    expect(SYSTEM_PROMPT).toContain('You cannot run anything');
  });
  it('refuses empty or huge input', () => {
    expect(aiRequestSchema.safeParse({ kind: 'ask', text: '  ' }).success).toBe(false);
    expect(aiRequestSchema.safeParse({ kind: 'ask', text: 'x'.repeat(9000) }).success).toBe(false);
    expect(aiRequestSchema.safeParse({ kind: 'delete', text: 'x' }).success).toBe(false);
  });
});

describe('reading the answer', () => {
  it('keeps a valid proposal and shows the REAL risk, not the model’s claim', () => {
    const a = parseAnswer(
      JSON.stringify({
        answer: 'Open the port.',
        actions: [
          {
            actionId: 'firewall.allow',
            params: { policy: 'allow', port: '443' },
            why: 'HTTPS',
            risk: 'safe',
          },
        ],
      }),
    );
    expect(a.proposals).toHaveLength(1);
    expect(a.proposals[0]).toMatchObject({
      actionId: 'firewall.allow',
      risk: 'caution',
      why: 'HTTPS',
    });
    expect(a.rejected).toBe(0);
  });
  it('drops invented actions, quiet ones, and bad parameters, and counts them', () => {
    const a = parseAnswer(
      JSON.stringify({
        answer: 'x',
        actions: [
          { actionId: 'system.rm-rf-everything', params: {}, why: '' },
          { actionId: 'firewall.status', params: {}, why: '' },
          { actionId: 'firewall.allow', params: { policy: 'allow', port: '80; reboot' }, why: '' },
          { actionId: 'firewall.allow', params: { policy: 'allow', port: '8080' }, why: 'ok' },
        ],
      }),
    );
    expect(a.proposals.map((p) => p.params)).toEqual([
      { policy: 'allow', port: '8080', proto: 'tcp', from: 'any' },
    ]);
    expect(a.rejected).toBe(3);
  });
  it('copes with fences, surrounding text, and plain text', () => {
    expect(parseAnswer('```json\n{"answer":"hi","actions":[]}\n```').answer).toBe('hi');
    expect(parseAnswer('Sure! {"answer":"hi","actions":[]} Hope that helps').answer).toBe('hi');
    const plain = parseAnswer('Just restart it.');
    expect(plain).toEqual({ answer: 'Just restart it.', proposals: [], rejected: 0 });
  });
  it('never returns more than 5 proposals, and scrubs the answer too', () => {
    const many = Array.from({ length: 9 }, () => ({
      actionId: 'firewall.allow',
      params: { policy: 'allow', port: '81' },
      why: '',
    }));
    expect(
      parseAnswer(JSON.stringify({ answer: 'set PASSWORD=leaked99', actions: many })).proposals,
    ).toHaveLength(5);
    expect(
      parseAnswer(JSON.stringify({ answer: 'set PASSWORD=leaked99', actions: [] })).answer,
    ).not.toContain('leaked99');
  });
});

describe('destination', () => {
  it('says where a send goes, and whether it stays on this computer', () => {
    expect(destinationOf({ provider: 'anthropic', baseUrl: '' })).toEqual({
      destination: 'api.anthropic.com',
      local: false,
    });
    expect(
      destinationOf({ provider: 'openai-compatible', baseUrl: 'http://127.0.0.1:11434/v1' }),
    ).toEqual({ destination: '127.0.0.1:11434', local: true });
    expect(
      destinationOf({ provider: 'openai-compatible', baseUrl: 'https://llm.example.com/v1' }).local,
    ).toBe(false);
  });
});
