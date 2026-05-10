import assert from 'assert';
import { describe, it } from 'node:test';
import { buildResourceCatalog } from '../src-backend/catalog.ts';

const col = (props: Record<string, any>) =>
  ({ primary: false, notNull: false, ...props });

const tableLike = (sqlName: string, columns: any[], primaryKeys: any[] = []) => {
  const t: any = { [Symbol.for('drizzle:Name')]: sqlName };
  // Real drizzle exposes columns as enumerable JS-keyed properties on the
  // table; the catalog reads `(table as any)[fk]` to translate JS field names
  // back to SQL names. Build the same shape for tests.
  for (const c of columns) { t[c.jsKey ?? c.name] = c; }
  return { table: t, cfg: { name: sqlName, columns, primaryKeys } };
};

const cfgFor = (table: any) => (table as any).__cfg;

describe('buildResourceCatalog', () => {
  it('builds the per-resource shape for a single-PK table with no relations', () => {
    const id = col({ name: 'id', primary: true, notNull: true, getSQLType: () => 'text', dataType: 'string' });
    const email = col({ name: 'email', getSQLType: () => 'text', dataType: 'string' });
    const { table, cfg } = tableLike('colyseus_users', [id, email]);
    table.__cfg = cfg;

    const catalog = buildResourceCatalog({
      tables: { users: table },
      resources: {},
      getTableConfig: cfgFor,
      relations: {},
    });

    assert.strictEqual(catalog.length, 1);
    const r = catalog[0]!;
    assert.strictEqual(r.name, 'users');
    assert.strictEqual(r.label, 'Users'); // humanize fallback
    assert.deepStrictEqual(r.primaryKey, ['id']);
    assert.strictEqual(r.columns.length, 2);
    assert.deepStrictEqual(r.columns[0], {
      name: 'id', label: 'Id', type: 'text', dataType: 'string',
      notNull: true, primary: true, hasDefault: false,
    });
    assert.deepStrictEqual(r.actions, []);
    assert.deepStrictEqual(r.relations, []);
  });

  it('uses ResourceDefinition overrides for label/icon/columns/actions', () => {
    const id = col({ name: 'id', primary: true, getSQLType: () => 'text' });
    const { table, cfg } = tableLike('colyseus_items', [id]);
    table.__cfg = cfg;
    const def: any = {
      __tableName: 'items',
      label: 'Inventory',
      icon: 'package',
      list: { columns: ['id'] },
      form: { fields: ['id'] },
      show: { fields: ['id'] },
      actions: [{ name: 'reset', label: 'Reset', perRow: true, confirm: { title: 'Are you sure?' } }],
    };

    const [r] = buildResourceCatalog({
      tables: { items: table },
      resources: { items: def },
      getTableConfig: cfgFor,
      relations: {},
    });

    assert.strictEqual(r!.label, 'Inventory');
    assert.strictEqual(r!.icon, 'package');
    assert.deepStrictEqual(r!.listColumns, ['id']);
    assert.deepStrictEqual(r!.formFields, ['id']);
    assert.deepStrictEqual(r!.showFields, ['id']);
    assert.strictEqual(r!.actions[0]!.label, 'Reset');
    assert.strictEqual(r!.actions[0]!.perRow, true);
    assert.deepStrictEqual(r!.actions[0]!.confirm, { title: 'Are you sure?' });
  });

  it('reports composite primary keys', () => {
    const userId = col({ name: 'user_id', getSQLType: () => 'text' });
    const itemId = col({ name: 'item_id', getSQLType: () => 'text' });
    const { table, cfg } = tableLike(
      'colyseus_player_items',
      [userId, itemId, col({ name: 'qty', getSQLType: () => 'integer' })],
      [{ columns: [userId, itemId] }],
    );
    table.__cfg = cfg;

    const [r] = buildResourceCatalog({
      tables: { playerItems: table },
      resources: {},
      getTableConfig: cfgFor,
      relations: {},
    });
    assert.deepStrictEqual(r!.primaryKey, ['user_id', 'item_id']);
  });

  it('emits relations with SQL fk names (translates from drizzle JS field names)', () => {
    // Source table: users
    const usersId = col({ name: 'id', primary: true, getSQLType: () => 'text' });
    const users = tableLike('colyseus_users', [usersId]);
    users.table.__cfg = users.cfg;

    // Target table: cloudSaves with userId (JS) → user_id (SQL) FK
    const userIdCol = col({ name: 'user_id', getSQLType: () => 'text', jsKey: 'userId' });
    const slot = col({ name: 'slot', getSQLType: () => 'integer' });
    const saves = tableLike('colyseus_cloud_saves', [userIdCol, slot]);
    saves.table.__cfg = saves.cfg;

    const [usersResource] = buildResourceCatalog({
      tables: { users: users.table, cloudSaves: saves.table },
      resources: {},
      getTableConfig: cfgFor,
      relations: {
        users: [{ name: 'saves', target: 'cloudSaves', kind: 'many', fk: 'userId' }],
      },
    });
    assert.strictEqual(usersResource!.relations.length, 1);
    const rel = usersResource!.relations[0]!;
    assert.strictEqual(rel.name, 'saves');
    assert.strictEqual(rel.kind, 'many');
    assert.strictEqual(rel.fk, 'user_id'); // translated from JS 'userId'
  });

  it('drops relations whose target is not registered as a resource', () => {
    const id = col({ name: 'id', primary: true, getSQLType: () => 'text' });
    const users = tableLike('colyseus_users', [id]);
    users.table.__cfg = users.cfg;

    const [r] = buildResourceCatalog({
      tables: { users: users.table },
      resources: {},
      getTableConfig: cfgFor,
      relations: {
        users: [{ name: 'guilds', target: 'guildMembers', kind: 'many', fk: 'userId' }],
      },
    });
    assert.deepStrictEqual(r!.relations, []);
  });

  it('marks hasDefault=true for any of {default, defaultFn, autoIncrement}', () => {
    const id = col({ name: 'id', primary: true, getSQLType: () => 'text', defaultFn: () => 'auto' });
    const created = col({ name: 'created_at', getSQLType: () => 'integer', dataType: 'date', hasDefault: true });
    // autoIncrement integer PKs (sqlite). Drizzle 1.0 also sets hasDefault
    // here, but the catalog defends against schema variants where it might
    // not — this test pins that behavior.
    const autoinc = col({ name: 'autoinc_id', primary: true, getSQLType: () => 'integer', autoIncrement: true });
    const plain = col({ name: 'plain', getSQLType: () => 'text' });
    const { table, cfg } = tableLike('t', [id, created, autoinc, plain]);
    table.__cfg = cfg;

    const [r] = buildResourceCatalog({
      tables: { t: table }, resources: {}, getTableConfig: cfgFor, relations: {},
    });
    assert.strictEqual(r!.columns[0]!.hasDefault, true);  // via defaultFn
    assert.strictEqual(r!.columns[1]!.hasDefault, true);  // via hasDefault
    assert.strictEqual(r!.columns[2]!.hasDefault, true);  // via autoIncrement
    assert.strictEqual(r!.columns[3]!.hasDefault, false); // neither
  });
});
