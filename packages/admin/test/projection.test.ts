import assert from 'assert';
import { describe, it } from 'node:test';
import { sqlKeyedProjection } from '../src-backend/internal/helpers.ts';

describe('sqlKeyedProjection', () => {
  it('keys columns by their SQL name (not the JS field name)', () => {
    const created = { name: 'created_at', _: 'createdAt' };
    const userId = { name: 'user_id', _: 'userId' };
    const id = { name: 'id', _: 'id' };
    const cfg = { columns: [id, created, userId] };

    const projection = sqlKeyedProjection(cfg);
    assert.deepStrictEqual(Object.keys(projection).sort(), ['created_at', 'id', 'user_id']);
    assert.strictEqual(projection['created_at'], created);
    assert.strictEqual(projection['user_id'], userId);
    assert.strictEqual(projection['id'], id);
  });

  it('returns an empty object when there are no columns', () => {
    assert.deepStrictEqual(sqlKeyedProjection({ columns: [] }), {});
  });
});
