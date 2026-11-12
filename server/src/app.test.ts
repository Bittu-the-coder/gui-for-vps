import { describe, expect, it } from 'vitest';
import { buildApp } from './app.js';

describe('health + auth', () => {
  it('rejects requests without a token', async () => {
    const app = await buildApp('secret');
    const res = await app.inject({ method: 'GET', url: '/api/health' });
    expect(res.statusCode).toBe(401);
  });
  it('rejects a wrong token', async () => {
    const app = await buildApp('secret');
    const res = await app.inject({
      method: 'GET',
      url: '/api/health',
      headers: { 'x-gfv-token': 'nope' },
    });
    expect(res.statusCode).toBe(401);
  });
  it('accepts the right token', async () => {
    const app = await buildApp('secret');
    const res = await app.inject({
      method: 'GET',
      url: '/api/health',
      headers: { 'x-gfv-token': 'secret' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().ok).toBe(true);
  });
});
