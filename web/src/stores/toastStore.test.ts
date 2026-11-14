import { beforeEach, describe, expect, it } from 'vitest';
import { MAX_TOASTS, toast, useToasts } from './toastStore';

beforeEach(() => useToasts.getState().clear());

describe('toasts', () => {
  it('adds a toast with defaults: info kind, errors stay longer', () => {
    toast({ title: 'Hello' });
    toast({ title: 'Oops', kind: 'error' });
    const [a, b] = useToasts.getState().toasts;
    expect(a).toMatchObject({ kind: 'info', title: 'Hello' });
    expect(b!.ttl).toBeGreaterThan(a!.ttl);
  });

  it('keeps only the newest few', () => {
    for (let i = 0; i < MAX_TOASTS + 3; i++) toast({ title: `t${i}` });
    const titles = useToasts.getState().toasts.map((t) => t.title);
    expect(titles).toHaveLength(MAX_TOASTS);
    expect(titles.at(-1)).toBe(`t${MAX_TOASTS + 2}`);
    expect(titles).not.toContain('t0');
  });

  it('dismiss removes just that toast', () => {
    const a = toast({ title: 'a' });
    toast({ title: 'b' });
    useToasts.getState().dismiss(a);
    expect(useToasts.getState().toasts.map((t) => t.title)).toEqual(['b']);
  });

  it('ids are unique', () => {
    const ids = [toast({ title: 'x' }), toast({ title: 'y' })];
    expect(new Set(ids).size).toBe(2);
  });
});
