import assert from 'assert';
import { describe, it } from 'node:test';
import { topologicalSort, type TableEntry } from '../src/schemas/registry.ts';
import { SQLITE_TABLES } from '../src/schemas/sqlite.ts';
import { PG_TABLES } from '../src/schemas/pg.ts';

const e = (key: string, dependsOn: string[] = []): TableEntry =>
  ({ key: key as any, table: {}, columns: {}, dependsOn: dependsOn as any });

describe('topologicalSort', () => {
  it('returns input order when there are no deps', () => {
    const sorted = topologicalSort([e('users'), e('configs'), e('items')]);
    assert.deepStrictEqual(sorted.map((x) => x.key), ['users', 'configs', 'items']);
  });

  it('moves dependents after their dependencies', () => {
    const sorted = topologicalSort([
      e('cloudSaves', ['users']),
      e('users'),
    ]);
    assert.deepStrictEqual(sorted.map((x) => x.key), ['users', 'cloudSaves']);
  });

  it('handles transitive deps', () => {
    const sorted = topologicalSort([
      e('c', ['b']),
      e('b', ['a']),
      e('a'),
    ]);
    assert.deepStrictEqual(sorted.map((x) => x.key), ['a', 'b', 'c']);
  });

  it('throws on cycles with the cycle path in the message', () => {
    assert.throws(
      () => topologicalSort([e('a', ['b']), e('b', ['a'])]),
      /dependency cycle.*a → b → a|dependency cycle.*b → a → b/,
    );
  });

  it('throws on unknown dependency', () => {
    assert.throws(
      () => topologicalSort([e('users', ['ghost'])]),
      /unknown dependency 'ghost'/,
    );
  });
});

describe('built-in registries', () => {
  it('SQLITE_TABLES and PG_TABLES expose the same keys in the same order', () => {
    assert.deepStrictEqual(
      SQLITE_TABLES.map((t) => t.key),
      PG_TABLES.map((t) => t.key),
    );
  });

  it('every entry topo-sorts cleanly (no cycles, no dangling deps)', () => {
    // Just verifying the shipped registries are valid — both regressions a
    // typo in `dependsOn` would otherwise only surface at db.boot() time.
    assert.doesNotThrow(() => topologicalSort(SQLITE_TABLES));
    assert.doesNotThrow(() => topologicalSort(PG_TABLES));
  });

  it('orders FK-bearing tables (cloudSaves, leaderboardEntries) after their parents', () => {
    const sorted = topologicalSort(SQLITE_TABLES).map((t) => t.key);
    assert.ok(sorted.indexOf('users') < sorted.indexOf('cloudSaves'));
    assert.ok(sorted.indexOf('users') < sorted.indexOf('leaderboardEntries'));
    assert.ok(sorted.indexOf('leaderboards') < sorted.indexOf('leaderboardEntries'));
    assert.ok(sorted.indexOf('items') < sorted.indexOf('playerItems'));
    assert.ok(sorted.indexOf('users') < sorted.indexOf('userNotes'));
  });
});
