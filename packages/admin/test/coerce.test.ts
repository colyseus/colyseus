import assert from 'assert';
import { describe, it } from 'node:test';
import { castFilterValue, castPk, coerceForColumn } from '../src-backend/helpers.ts';

const col = (props: Record<string, any>) => props;

describe('castPk', () => {
  it('coerces integer-typed PK to Number', () => {
    assert.strictEqual(castPk('42', { getSQLType: () => 'integer' }), 42);
    assert.strictEqual(castPk('0', { getSQLType: () => 'serial' }), 0);
    assert.strictEqual(castPk('9007199254740993', { getSQLType: () => 'bigint' }), 9007199254740993);
  });

  it('passes string PKs through untouched', () => {
    assert.strictEqual(castPk('user_abc', { getSQLType: () => 'text' }), 'user_abc');
    assert.strictEqual(castPk('uuid-1', { getSQLType: () => 'varchar' }), 'uuid-1');
  });

  it('handles columns without getSQLType (treats as string)', () => {
    assert.strictEqual(castPk('foo', {}), 'foo');
  });
});

describe('castFilterValue', () => {
  it('parses numbers, falls back to raw on NaN', () => {
    assert.strictEqual(castFilterValue('42', col({ dataType: 'number' })), 42);
    assert.strictEqual(castFilterValue('not-a-number', col({ dataType: 'number' })), 'not-a-number');
  });

  it('parses dates, falls back to raw on invalid', () => {
    const v = castFilterValue('2026-05-09', col({ dataType: 'date' }));
    assert.ok(v instanceof Date);
    assert.strictEqual((v as Date).getUTCFullYear(), 2026);
    assert.strictEqual(castFilterValue('not-a-date', col({ dataType: 'date' })), 'not-a-date');
  });

  it('treats "true"/"1" as true booleans, anything else false', () => {
    assert.strictEqual(castFilterValue('true', col({ dataType: 'boolean' })), true);
    assert.strictEqual(castFilterValue('1', col({ dataType: 'boolean' })), true);
    assert.strictEqual(castFilterValue('false', col({ dataType: 'boolean' })), false);
    assert.strictEqual(castFilterValue('0', col({ dataType: 'boolean' })), false);
  });

  it('parses JSON, falls back to raw on syntax error', () => {
    assert.deepStrictEqual(castFilterValue('{"a":1}', col({ dataType: 'json' })), { a: 1 });
    assert.strictEqual(castFilterValue('{not json', col({ dataType: 'json' })), '{not json');
  });

  it('passes through unknown dataTypes as raw strings', () => {
    assert.strictEqual(castFilterValue('hello', col({ dataType: 'string' })), 'hello');
    assert.strictEqual(castFilterValue('hello', col({})), 'hello');
  });
});

describe('coerceForColumn', () => {
  it('passes null/undefined through unchanged', () => {
    assert.strictEqual(coerceForColumn(null, col({ dataType: 'date' })), null);
    assert.strictEqual(coerceForColumn(undefined, col({ dataType: 'number' })), undefined);
  });

  it('returns value unchanged when col is missing', () => {
    assert.strictEqual(coerceForColumn('42', null), '42');
    assert.strictEqual(coerceForColumn('42', undefined), '42');
  });

  it('empty string becomes null on non-string columns', () => {
    assert.strictEqual(coerceForColumn('', col({ dataType: 'number' })), null);
    assert.strictEqual(coerceForColumn('', col({ dataType: 'date' })), null);
    assert.strictEqual(coerceForColumn('', col({ dataType: 'boolean' })), null);
    // String columns keep empty string as a real value (legitimate clear).
    assert.strictEqual(coerceForColumn('', col({ dataType: 'string' })), '');
  });

  it('parses datetime-local-style strings into Date for date columns', () => {
    const v = coerceForColumn('2026-05-09T22:05', col({ dataType: 'date' }));
    assert.ok(v instanceof Date);
    assert.strictEqual(isNaN((v as Date).getTime()), false);
  });

  it('keeps an existing Date instance for date columns', () => {
    const d = new Date('2026-01-01');
    assert.strictEqual(coerceForColumn(d, col({ dataType: 'date' })), d);
  });

  it('parses unix-millis numbers into Date for date columns', () => {
    const v = coerceForColumn(1_700_000_000_000, col({ dataType: 'date' }));
    assert.ok(v instanceof Date);
    assert.strictEqual((v as Date).getTime(), 1_700_000_000_000);
  });

  it('returns null for unparseable date strings (not the raw string — drizzle would crash on it)', () => {
    assert.strictEqual(coerceForColumn('not-a-date', col({ dataType: 'date' })), null);
  });

  it('parses numeric strings into numbers', () => {
    assert.strictEqual(coerceForColumn('42', col({ dataType: 'number' })), 42);
    assert.strictEqual(coerceForColumn('3.14', col({ dataType: 'number' })), 3.14);
    assert.strictEqual(coerceForColumn(7, col({ dataType: 'number' })), 7);
  });

  it('falls back to raw for non-finite numeric strings', () => {
    assert.strictEqual(coerceForColumn('abc', col({ dataType: 'number' })), 'abc');
  });

  it('coerces "true"/"1"/numbers into booleans', () => {
    assert.strictEqual(coerceForColumn('true', col({ dataType: 'boolean' })), true);
    assert.strictEqual(coerceForColumn('false', col({ dataType: 'boolean' })), false);
    assert.strictEqual(coerceForColumn('1', col({ dataType: 'boolean' })), true);
    assert.strictEqual(coerceForColumn('0', col({ dataType: 'boolean' })), false);
    assert.strictEqual(coerceForColumn(1, col({ dataType: 'boolean' })), true);
    assert.strictEqual(coerceForColumn(0, col({ dataType: 'boolean' })), false);
    assert.strictEqual(coerceForColumn(true, col({ dataType: 'boolean' })), true);
  });

  it('parses JSON strings on json columns; falls back to raw on syntax error', () => {
    assert.deepStrictEqual(coerceForColumn('[1,2,3]', col({ dataType: 'json' })), [1, 2, 3]);
    assert.deepStrictEqual(coerceForColumn('"hi"', col({ dataType: 'json' })), 'hi');
    assert.strictEqual(coerceForColumn('{not json', col({ dataType: 'json' })), '{not json');
  });

  it('keeps non-string values on json columns (already parsed by request body parser)', () => {
    const obj = { a: 1 };
    assert.strictEqual(coerceForColumn(obj, col({ dataType: 'json' })), obj);
  });

  it('handles multi-token dataTypes ("number bigint", etc.)', () => {
    // drizzle reports `dataType` as space-separated when a column has multiple
    // type categories. We tokenize by whitespace, so `'bigint number'` should
    // still coerce.
    assert.strictEqual(coerceForColumn('42', col({ dataType: 'bigint number' })), 42);
  });
});
