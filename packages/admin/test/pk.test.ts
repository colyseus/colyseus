import assert from 'assert';
import { describe, it } from 'node:test';
import { buildPkWhere, pkColumns } from '../src-backend/helpers.ts';

const intCol = (props: Record<string, any> = {}) =>
  ({ getSQLType: () => 'integer', ...props });
const textCol = (props: Record<string, any> = {}) =>
  ({ getSQLType: () => 'text', ...props });

describe('pkColumns', () => {
  it('returns single-PK columns first', () => {
    const id = textCol({ name: 'id', primary: true });
    const name = textCol({ name: 'display_name' });
    const cfg = { columns: [id, name], primaryKeys: [] };
    assert.deepStrictEqual(pkColumns(cfg), [id]);
  });

  it('falls back to composite PK from cfg.primaryKeys[0].columns', () => {
    const a = intCol({ name: 'tenant_id' });
    const b = intCol({ name: 'user_id' });
    const cfg = {
      columns: [a, b, textCol({ name: 'note' })],
      primaryKeys: [{ columns: [a, b] }],
    };
    assert.deepStrictEqual(pkColumns(cfg), [a, b]);
  });

  it('returns [] when there is no PK at all', () => {
    const cfg = { columns: [textCol({ name: 'memo' })], primaryKeys: [] };
    assert.deepStrictEqual(pkColumns(cfg), []);
  });

  it('treats undefined primaryKeys the same as empty', () => {
    const cfg = { columns: [textCol({ name: 'memo' })] };
    assert.deepStrictEqual(pkColumns(cfg), []);
  });
});

describe('buildPkWhere', () => {
  it('builds a single-PK WHERE for a typical row id', () => {
    const id = textCol({ name: 'id', primary: true });
    const cfg = { columns: [id], primaryKeys: [] };
    const result = buildPkWhere(cfg, 'user_42');
    assert.strictEqual(result.ok, true);
    if (result.ok) {
      assert.ok(result.where);
    }
  });

  it('builds a composite WHERE when the id is the encoded tuple', () => {
    const a = intCol({ name: 'tenant_id' });
    const b = intCol({ name: 'user_id' });
    const cfg = { columns: [a, b], primaryKeys: [{ columns: [a, b] }] };
    // Tuple [1, 2] base64url-encoded, which is what
    // composite-id.tryDecodeCompositeId expects.
    const encoded = Buffer.from(JSON.stringify([1, 2]), 'utf8').toString('base64url');
    const result = buildPkWhere(cfg, encoded);
    assert.strictEqual(result.ok, true);
    if (result.ok) {
      assert.ok(result.where);
    }
  });

  it('returns 400 when the table has no PK', () => {
    const cfg = { columns: [textCol({ name: 'memo' })], primaryKeys: [] };
    const result = buildPkWhere(cfg, 'whatever');
    assert.deepStrictEqual(result, {
      ok: false, status: 400, message: 'resource has no primary key',
    });
  });

  it('returns 400 with arity mismatch when composite id has wrong length', () => {
    const a = intCol({ name: 'tenant_id' });
    const b = intCol({ name: 'user_id' });
    const cfg = { columns: [a, b], primaryKeys: [{ columns: [a, b] }] };
    const encoded = Buffer.from(JSON.stringify([1, 2, 3]), 'utf8').toString('base64url');
    const result = buildPkWhere(cfg, encoded);
    assert.strictEqual(result.ok, false);
    if (!result.ok) {
      assert.strictEqual(result.status, 400);
      assert.match(result.message, /arity mismatch.*expected 2.*got 3/);
    }
  });
});
