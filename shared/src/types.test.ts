import { describe, expect, it } from 'vitest';
import { HealthSchema } from './types.js';

describe('HealthSchema', () => {
  it('accepts a valid health payload', () => {
    expect(HealthSchema.parse({ ok: true, name: 'gfv', version: '0.0.0' }).ok).toBe(true);
  });
  it('rejects ok: false', () => {
    expect(HealthSchema.safeParse({ ok: false, name: 'gfv', version: '0' }).success).toBe(false);
  });
});
