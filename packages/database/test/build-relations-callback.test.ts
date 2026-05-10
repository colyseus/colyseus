import assert from 'assert';
import { describe, it } from 'node:test';
import { buildRelationsCallback, resolveFkLayout, type RelationDefinition } from '../src/relations-meta.ts';

// Mock drizzle table — only the property surface we read.
const mkCol = (name: string, primary = false) => ({ name, primary });
const mkTable = (cols: Record<string, any>) => ({ ...cols });

// Mock drizzle helpers — record what builder.from/to references were used,
// so each test can assert which join the callback constructed.
function mockHelpers(tables: Record<string, any>) {
  const h: any = { one: {}, many: {} };
  // Per-table proxies that turn `h.<table>.<col>` into a tagged ref.
  for (const tableName of Object.keys(tables)) {
    h[tableName] = new Proxy({}, {
      get(_, col: string) { return { _ref: `${tableName}.${col}` }; },
    });
  }
  // Per-target builder factories for one() / many() — capture config args.
  for (const target of Object.keys(tables)) {
    h.one[target]  = (config: any) => ({ kind: 'one',  target, ...config });
    h.many[target] = (config: any) => ({ kind: 'many', target, ...config });
  }
  return h;
}

describe('resolveFkLayout', () => {
  it('detects FK on source (child → parent)', () => {
    const cloudSaves = mkTable({ userId: mkCol('user_id'), slot: mkCol('slot', true) });
    const users = mkTable({ id: mkCol('id', true) });
    const layout = resolveFkLayout(cloudSaves, users, 'userId');
    assert.deepStrictEqual(layout, { fkOn: 'source', fkCol: cloudSaves.userId });
  });

  it('detects FK on target (parent → many children)', () => {
    const users = mkTable({ id: mkCol('id', true) });
    const cloudSaves = mkTable({ userId: mkCol('user_id'), slot: mkCol('slot', true) });
    const layout = resolveFkLayout(users, cloudSaves, 'userId');
    assert.deepStrictEqual(layout, { fkOn: 'target', fkCol: cloudSaves.userId });
  });

  it('prefers source when the same JS-named column exists on both', () => {
    // E.g. junction-y tables where source and target both have a `userId`
    // column. Source wins so we don't accidentally invert the join.
    const a = mkTable({ userId: mkCol('user_id') });
    const b = mkTable({ userId: mkCol('user_id') });
    const layout = resolveFkLayout(a, b, 'userId');
    assert.equal(layout?.fkOn, 'source');
  });

  it('returns null when the FK column is on neither side', () => {
    const a = mkTable({ id: mkCol('id', true) });
    const b = mkTable({ id: mkCol('id', true) });
    assert.equal(resolveFkLayout(a, b, 'mysteriousFk'), null);
  });

  it('returns null when either table is missing', () => {
    const a = mkTable({ id: mkCol('id', true) });
    assert.equal(resolveFkLayout(a, null, 'id'), null);
    assert.equal(resolveFkLayout(undefined, a, 'id'), null);
  });
});

describe('buildRelationsCallback', () => {
  it('handles "many" relations (FK on target → source PK)', () => {
    const users      = mkTable({ id: mkCol('id', true) });
    const cloudSaves = mkTable({ userId: mkCol('user_id'), slot: mkCol('slot', true) });
    const tables = { users, cloudSaves };
    const relations: Record<string, RelationDefinition[]> = {
      users: [{ name: 'saves', target: 'cloudSaves', kind: 'many', fk: 'userId' }],
    };

    const callback = buildRelationsCallback(tables, relations);
    const config = callback(mockHelpers(tables));

    assert.deepStrictEqual(config, {
      users: {
        saves: {
          kind: 'many', target: 'cloudSaves',
          from: { _ref: 'users.id' },
          to:   { _ref: 'cloudSaves.userId' },
        },
      },
    });
  });

  it('handles "one" relations where FK lives on source (child → parent)', () => {
    const users      = mkTable({ id: mkCol('id', true) });
    const cloudSaves = mkTable({ userId: mkCol('user_id', true), slot: mkCol('slot', true) });
    const tables = { users, cloudSaves };
    const relations: Record<string, RelationDefinition[]> = {
      cloudSaves: [{ name: 'user', target: 'users', kind: 'one', fk: 'userId' }],
    };

    const callback = buildRelationsCallback(tables, relations);
    const config = callback(mockHelpers(tables));

    assert.deepStrictEqual(config.cloudSaves!['user'], {
      kind: 'one', target: 'users',
      from: { _ref: 'cloudSaves.userId' },
      to:   { _ref: 'users.id' },
    });
  });

  it('handles "one" relations where FK lives on target (parent → singleton child)', () => {
    // userRoles' PK is itself `userId`, mirroring the real schema. The FK
    // column lives on the TARGET, not the source — different from the
    // typical child-points-to-parent shape.
    const users     = mkTable({ id: mkCol('id', true) });
    const userRoles = mkTable({ userId: mkCol('user_id', true), role: mkCol('role') });
    const tables = { users, userRoles };
    const relations: Record<string, RelationDefinition[]> = {
      users: [{ name: 'role', target: 'userRoles', kind: 'one', fk: 'userId' }],
    };

    const callback = buildRelationsCallback(tables, relations);
    const config = callback(mockHelpers(tables));

    assert.deepStrictEqual(config.users!['role'], {
      kind: 'one', target: 'userRoles',
      from: { _ref: 'users.id' },
      to:   { _ref: 'userRoles.userId' },
    });
  });

  it('skips relations whose target table is not registered', () => {
    const users = mkTable({ id: mkCol('id', true) });
    const tables = { users }; // no `guildMembers`
    const relations: Record<string, RelationDefinition[]> = {
      users: [{ name: 'guilds', target: 'guildMembers', kind: 'many', fk: 'userId' }],
    };
    const config = buildRelationsCallback(tables, relations)(mockHelpers(tables));
    assert.deepStrictEqual(config, {});
  });

  it('skips relations whose FK column is not on either side', () => {
    const users = mkTable({ id: mkCol('id', true) });
    const items = mkTable({ id: mkCol('id', true), name: mkCol('name') });
    const tables = { users, items };
    // typo: `userId` is on neither table
    const relations: Record<string, RelationDefinition[]> = {
      users: [{ name: 'items', target: 'items', kind: 'many', fk: 'userId' }],
    };
    const config = buildRelationsCallback(tables, relations)(mockHelpers(tables));
    assert.deepStrictEqual(config, {});
  });

  it('emits both directions when both are declared', () => {
    const users      = mkTable({ id: mkCol('id', true) });
    const cloudSaves = mkTable({ userId: mkCol('user_id'), slot: mkCol('slot', true) });
    const tables = { users, cloudSaves };
    const relations: Record<string, RelationDefinition[]> = {
      users: [{ name: 'saves', target: 'cloudSaves', kind: 'many', fk: 'userId' }],
      cloudSaves: [{ name: 'user', target: 'users', kind: 'one', fk: 'userId' }],
    };
    const config = buildRelationsCallback(tables, relations)(mockHelpers(tables));
    assert.ok(config.users?.['saves']);
    assert.ok(config.cloudSaves?.['user']);
  });
});
