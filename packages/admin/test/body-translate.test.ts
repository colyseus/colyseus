import assert from 'assert';
import { describe, it } from 'node:test';
import { translateBodyKeys } from '../src-backend/internal/helpers.ts';

const col = (name: string, dataType?: string) =>
  ({ name, dataType });

describe('translateBodyKeys', () => {
  it('rewrites SQL column names to JS field names', () => {
    const table = {
      id: col('id', 'string'),
      userId: col('user_id', 'string'),
      createdAt: col('created_at', 'date'),
    };
    const out = translateBodyKeys({ id: 'u1', user_id: 'u2', created_at: '2026-05-09T10:00' }, table);
    assert.strictEqual(out.id, 'u1');
    assert.strictEqual(out.userId, 'u2');
    assert.ok(out.createdAt instanceof Date);
  });

  it('passes through keys that already match the JS field name', () => {
    const table = { userId: col('user_id', 'string') };
    const out = translateBodyKeys({ userId: 'u3' }, table);
    assert.strictEqual(out.userId, 'u3');
  });

  it('coerces values via coerceForColumn (integration with helpers.ts)', () => {
    const table = {
      score: col('score', 'number'),
      enabled: col('enabled', 'boolean'),
      bio: col('bio', 'string'),
    };
    const out = translateBodyKeys({ score: '42', enabled: 'true', bio: '' }, table);
    assert.strictEqual(out.score, 42);
    assert.strictEqual(out.enabled, true);
    // Empty string is preserved on string columns (not all coerce paths null it).
    assert.strictEqual(out.bio, '');
  });

  it('empty string clears nullable non-string columns', () => {
    const table = { until: col('banned_until', 'date') };
    const out = translateBodyKeys({ banned_until: '' }, table);
    assert.strictEqual(out.until, null);
  });

  it('keeps unknown body keys but does not coerce them (no col)', () => {
    const table = { userId: col('user_id', 'string') };
    const out = translateBodyKeys({ unknown_extra: 'kept' }, table);
    assert.strictEqual(out.unknown_extra, 'kept');
  });

  it('ignores non-column entries on the table object (helpers, symbols)', () => {
    const table = {
      userId: col('user_id', 'string'),
      __fooHelper: () => {}, // method, not a column — must be skipped
      __noName: { foo: 1 },  // object without `name`
    };
    const out = translateBodyKeys({ user_id: 'u4' }, table);
    assert.strictEqual(out.userId, 'u4');
    assert.strictEqual(Object.keys(out).length, 1);
  });
});
