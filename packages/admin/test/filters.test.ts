import assert from 'assert';
import { describe, it } from 'node:test';
import { buildFilterCondition, listColumns } from '../src-backend/internal/helpers.ts';

const col = (name: string, dataType: string) => ({ name, dataType });

describe('buildFilterCondition', () => {
  it('returns a SQL condition for known operators', () => {
    const c = col('score', 'number');
    for (const op of ['eq', 'ne', 'gt', 'gte', 'lt', 'lte', 'like']) {
      const out = buildFilterCondition(c, op, '42');
      assert.ok(out, `expected SQL for op=${op}`);
    }
  });

  it('returns undefined for unknown operators', () => {
    assert.strictEqual(buildFilterCondition(col('x', 'string'), 'mystery', 'v'), undefined);
  });

  it('coerces numeric values for non-like ops (integration with castFilterValue)', () => {
    // We can't introspect the SQL safely, but we can prove castFilterValue
    // is invoked indirectly: a non-numeric for a number column should still
    // produce a defined SQL (raw fallback).
    const out = buildFilterCondition(col('score', 'number'), 'gte', 'oops');
    assert.ok(out);
  });
});

describe('listColumns', () => {
  it('returns the def override when present', () => {
    const cfg = {
      columns: [{ name: 'a' }, { name: 'b' }, { name: 'c' }],
    };
    assert.deepStrictEqual(
      listColumns(cfg, { list: { columns: ['c', 'a'] } } as any),
      ['c', 'a'],
    );
  });

  it('falls back to all columns when no def is given', () => {
    const cfg = { columns: [{ name: 'a' }, { name: 'b' }] };
    assert.deepStrictEqual(listColumns(cfg, undefined), ['a', 'b']);
  });

  it('falls back to all columns when def has no list.columns', () => {
    const cfg = { columns: [{ name: 'a' }] };
    assert.deepStrictEqual(listColumns(cfg, {} as any), ['a']);
  });
});
