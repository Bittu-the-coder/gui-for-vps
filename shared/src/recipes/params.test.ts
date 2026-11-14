import { describe, expect, it } from 'vitest';
import {
  findPlaceholders,
  paramProblems,
  resolveValues,
  substitute,
  type RecipeParam,
} from './params';

const p = (name: string, over: Partial<RecipeParam> = {}): RecipeParam => ({
  name,
  label: name,
  ...over,
});

describe('findPlaceholders', () => {
  it('finds names anywhere, once each', () => {
    expect(
      findPlaceholders({ a: 'x {{domain}} y', b: ['{{db_pass}}', { c: '{{ domain }}' }] }).sort(),
    ).toEqual(['db_pass', 'domain']);
  });
  it('ignores things that are not placeholders', () => {
    expect(findPlaceholders({ a: '{{Bad}}', b: '{domain}', c: 5, d: null })).toEqual([]);
  });
});

describe('substitute', () => {
  it('replaces inside strings, nested values and arrays, leaving other types alone', () => {
    expect(
      substitute(
        { path: '/var/www/{{domain}}/x', n: 3, list: ['{{domain}}', true] },
        { domain: 'a.com' },
      ),
    ).toEqual({ path: '/var/www/a.com/x', n: 3, list: ['a.com', true] });
  });
  it('leaves unknown placeholders in place', () => {
    expect(substitute('{{known}} {{unknown}}', { known: 'k' })).toBe('k {{unknown}}');
  });
  it('a value containing placeholder syntax is not substituted again', () => {
    expect(substitute('{{a}}', { a: '{{b}}', b: 'LEAK' })).toBe('{{b}}');
  });
  it('is not fooled by prototype names', () => {
    expect(substitute('{{constructor}}', {})).toBe('{{constructor}}');
  });
});

describe('resolveValues', () => {
  it('uses a given value, else the default', () => {
    expect(resolveValues([p('a', { default: 'd' }), p('b', { default: 'd' })], { a: 'x' })).toEqual(
      {
        ok: true,
        values: { a: 'x', b: 'd' },
      },
    );
  });
  it('lists required parameters with neither', () => {
    expect(resolveValues([p('a'), p('b', { default: '1' })], {})).toEqual({
      ok: false,
      missing: ['a'],
    });
  });
  it('an empty string counts as not given', () => {
    expect(resolveValues([p('a', { default: 'd' })], { a: '' })).toEqual({
      ok: true,
      values: { a: 'd' },
    });
  });
  it('a secret is never defaulted: it must be supplied', () => {
    expect(resolveValues([p('pw', { secret: true, default: 'oops' })], {})).toEqual({
      ok: false,
      missing: ['pw'],
    });
  });
});

describe('paramProblems', () => {
  it('reports undeclared placeholders and duplicate declarations', () => {
    const out = paramProblems([p('a'), p('a')], [{ x: '{{a}} {{ghost}}' }]);
    expect(out.join('|')).toContain('declared twice');
    expect(out.join('|')).toContain('{{ghost}}');
  });
  it('is quiet for a consistent recipe', () => {
    expect(paramProblems([p('domain')], [{ x: '{{domain}}' }, { y: 'plain' }])).toEqual([]);
  });
});
