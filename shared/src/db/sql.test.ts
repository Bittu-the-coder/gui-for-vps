import { describe, expect, it } from 'vitest';
import { classifySql, connectionSchema, formatCell, quoteIdent, stripSql, toCsv } from './sql.js';

describe('quoteIdent', () => {
  it('quotes and escapes', () => {
    expect(quoteIdent('users')).toBe('"users"');
    expect(quoteIdent('we"ird')).toBe('"we""ird"');
    expect(quoteIdent('x"; drop table y; --')).toBe('"x""; drop table y; --"');
    expect(() => quoteIdent('a\0b')).toThrow();
  });
});

describe('classifySql', () => {
  it('reads are reads', () => {
    for (const q of [
      'select 1',
      "SELECT * FROM users WHERE name = 'delete me'",
      'explain select 1',
      'show server_version',
      'with a as (select 1) select * from a',
      '  -- hi\n select 1',
      "select '; drop table x'",
    ])
      expect(classifySql(q), q).toBe('read');
  });
  it('anything that changes data or schema is a write, even hidden in a CTE', () => {
    for (const q of [
      'insert into t values (1)',
      'UPDATE t SET a=1',
      'delete from t',
      'drop table t',
      'truncate t',
      'create table t(a int)',
      'alter table t add b int',
      'with x as (delete from t returning *) select * from x',
      'select 1; drop table t',
      '/* c */ drop /* d */ table t',
      "copy t to program 'x'",
      'do $$ begin end $$',
      'grant all on t to u',
    ])
      expect(classifySql(q), q).toBe('write');
  });
  it('comments and string contents do not fool it', () => {
    expect(stripSql("select 'a''b -- not a comment' -- real comment\n, 1")).toBe("select '' \n, 1");
    expect(classifySql('select $$drop table x$$')).toBe('read');
    expect(classifySql('')).toBe('empty');
    expect(classifySql('  -- only a comment')).toBe('empty');
  });
});

describe('formatting', () => {
  it('formats cells', () => {
    expect(formatCell(null)).toBeNull();
    expect(formatCell(5)).toBe('5');
    expect(formatCell(true)).toBe('true');
    expect(formatCell(new Date('2026-01-02T03:04:05Z'))).toBe('2026-01-02T03:04:05.000Z');
    expect(formatCell({ a: [1] })).toBe('{"a":[1]}');
    expect(formatCell(new Uint8Array([0, 255]))).toBe('\\x00ff');
    expect(formatCell(12345678901234567890n)).toBe('12345678901234567890');
  });
  it('CSV quotes, and defuses spreadsheet formulas', () => {
    expect(
      toCsv(
        ['a', 'b'],
        [
          ['1', 'x,y'],
          [null, 'say "hi"'],
          ['=SUM(A1)', '@cmd'],
        ],
      ),
    ).toBe('a,b\r\n1,"x,y"\r\n,"say ""hi"""\r\n\'=SUM(A1),\'@cmd\r\n');
  });
});

describe('connection input', () => {
  const ok = {
    name: 'db',
    host: '127.0.0.1',
    port: 5432,
    database: 'app',
    user: 'postgres',
    password: 'x',
  };
  it('accepts a normal one and refuses odd hosts and names', () => {
    expect(connectionSchema.safeParse(ok).success).toBe(true);
    for (const bad of [
      { ...ok, host: 'a b' },
      { ...ok, host: 'x;y' },
      { ...ok, port: 0 },
      { ...ok, database: 'a"b' },
      { ...ok, user: '' },
      { ...ok, name: '' },
    ])
      expect(connectionSchema.safeParse(bad).success, JSON.stringify(bad)).toBe(false);
  });
});
