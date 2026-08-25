/**
 * SegmentsService — declarative cohort resolution.
 *
 * Verifies the v1 contract: segments are defined in code, the service runs
 * each segment's resolver against the live DB on demand, and the standard
 * accessors (list/size/ids/has/forEach) work.
 *
 * Runs against the sqlite + pglite matrix. The compile-time type assertion
 * suites are dialect-independent so they only register under sqlite to
 * avoid duplicate-test noise.
 */
import assert from 'node:assert';
import { describe, it, beforeEach, afterEach } from 'node:test';
import { eq, gte } from 'drizzle-orm';
import {
  GameDatabase,
  defineSegment,
  createSegmentDefiner,
  tables as schemaFactories,
} from '../src/index.ts';
import { integer as sqliteInteger, text as sqliteText } from 'drizzle-orm/sqlite-core';
import { integer as pgInteger } from 'drizzle-orm/pg-core';
import { BACKENDS, type Backend } from './backends.ts';

// Per-backend custom users table with `level`. Built once per backend so the
// segment fixtures + the GameDatabase instance share the same drizzle object.
function buildUsersTable(backendName: 'sqlite' | 'pglite') {
  if (backendName === 'sqlite') {
    return schemaFactories.sqlite.users('users', {
      level: sqliteInteger('level').default(1),
    });
  }
  return schemaFactories.pg.users('users', {
    level: pgInteger('level').default(1),
  });
}

for (const backend of BACKENDS) {
  describe(`SegmentsService (${backend.name})`, () => {
    const users = buildUsersTable(backend.name);
    let db: GameDatabase<{ users: typeof users }>;

    const lowLevel = defineSegment('lowLevel', {
      description: 'Players still under level 5',
      resolve: async ({ drizzle, tables }) => {
        const rows = await drizzle
          .select({ id: tables.users.id })
          .from(tables.users)
          .where(eq(tables.users.level, 1));
        return rows.map((r: { id: string }) => r.id);
      },
    });

    const highLevel = defineSegment('highLevel', {
      description: 'Level >= 10',
      resolve: async ({ drizzle, tables }) => {
        const rows = await drizzle
          .select({ id: tables.users.id })
          .from(tables.users)
          .where(gte(tables.users.level, 10));
        return rows.map((r: { id: string }) => r.id);
      },
    });

    beforeEach(async () => {
      db = backend.newDb({
        schemas: { users },
        segments: [lowLevel, highLevel],
      }) as GameDatabase<{ users: typeof users }>;
      await db.boot();

      // Seed: 3 newbies at level 1, 2 vets at level 12 + 50.
      await Promise.all([
        db.auth.settings.onRegisterAnonymously?.({}),
        db.auth.settings.onRegisterAnonymously?.({}),
        db.auth.settings.onRegisterAnonymously?.({}),
      ]);
      const vet1 = (await db.auth.settings.onRegisterAnonymously?.({})) as { id: string };
      const vet2 = (await db.auth.settings.onRegisterAnonymously?.({})) as { id: string };
      await db.drizzle.update(users).set({ level: 12 }).where(eq(users.id, vet1.id));
      await db.drizzle.update(users).set({ level: 50 }).where(eq(users.id, vet2.id));
    });

    afterEach(async () => { if (db) { await backend.cleanupOne(db); } });

    it('list() returns metadata for every registered segment without hitting the DB', () => {
      const list = db.segments.list();
      assert.deepEqual(
        list.map((s) => s.id).sort(),
        ['highLevel', 'lowLevel'],
      );
      const low = list.find((s) => s.id === 'lowLevel')!;
      assert.equal(low.description, 'Players still under level 5');
    });

    it('size() runs the resolver and returns the live count', async () => {
      assert.equal(await db.segments.size('lowLevel'), 3);
      assert.equal(await db.segments.size('highLevel'), 2);
    });

    it('ids() returns the user ids in the segment', async () => {
      const lowIds = await db.segments.ids('lowLevel');
      const highIds = await db.segments.ids('highLevel');
      assert.equal(lowIds.length, 3);
      assert.equal(highIds.length, 2);
      // No overlap — disjoint cohorts here
      for (const id of lowIds) { assert.ok(!highIds.includes(id)); }
    });

    it('has() reports membership without exposing the full id list to callers', async () => {
      const highIds = await db.segments.ids('highLevel');
      assert.equal(await db.segments.has('highLevel', highIds[0]!), true);
      const lowIds = await db.segments.ids('lowLevel');
      assert.equal(await db.segments.has('highLevel', lowIds[0]!), false);
    });

    it('forEach() iterates members sequentially', async () => {
      const visited: string[] = [];
      await db.segments.forEach('highLevel', (id) => { visited.push(id); });
      assert.equal(visited.length, 2);
    });

    it('throws a helpful error for unknown segments', async () => {
      await assert.rejects(
        () => db.segments.size('whales'),
        /unknown segment 'whales'.*known: lowLevel, highLevel/,
      );
    });

    it('throws on duplicate segment ids at construction time', async () => {
      await db.shutdown();
      db = backend.newDb({
        schemas: { users },
        segments: [lowLevel, lowLevel],
      }) as GameDatabase<{ users: typeof users }>;
      await assert.rejects(() => db.boot(), /duplicate segment id: lowLevel/);
    });

    it('db.segments.define(...) types tables + drizzle via the GameDatabase generic', async () => {
      // No createSegmentDefiner / no <typeof schema> needed — the class generic
      // already carries the schema type, so the resolver gets full inference
      // for free.
      await db.shutdown();
      const inline = backend.newDb({
        schemas: { users },
      }) as GameDatabase<{ users: typeof users }>;
      inline.segments.define('inlineTyped', {
        description: 'level 1, defined inline',
        resolve: async ({ drizzle, tables }) => {
          const rows = await drizzle
            .select({ id: tables.users.id })
            .from(tables.users)
            .where(eq(tables.users.level, 1));
          return rows.map((r) => r.id);
        },
      });
      await inline.boot();

      // seed one user at level 1, one at 12
      await inline.auth.settings.onRegisterAnonymously?.({});
      const vet = (await inline.auth.settings.onRegisterAnonymously?.({})) as { id: string };
      await inline.drizzle.update(users).set({ level: 12 }).where(eq(users.id, vet.id));

      assert.equal(await inline.segments.size('inlineTyped'), 1);
      db = inline; // afterEach handles cleanup
    });

    it("where-based segment composes count(*) — size doesn't materialize ids", async () => {
      db.segments.define('whereLow', {
        description: 'where-based equivalent of lowLevel',
        where: ({ tables }) => eq(tables.users.level, 1),
      });

      assert.equal(await db.segments.size('whereLow'), 3);

      // SQL pagination — limit 2 should return exactly 2 ids; offset advances.
      const page1 = await db.segments.ids('whereLow', { limit: 2 });
      assert.equal(page1.length, 2);
      const page2 = await db.segments.ids('whereLow', { limit: 2, offset: 2 });
      assert.equal(page2.length, 1);
      assert.notDeepEqual(page1, page2);

      const allIds = await db.segments.ids('whereLow');
      assert.equal(await db.segments.has('whereLow', allIds[0]!), true);

      db.segments.define('whereHigh', {
        where: ({ tables }) => gte(tables.users.level, 10),
      });
      assert.equal(await db.segments.size('whereHigh'), 2);
      assert.equal(await db.segments.has('whereHigh', allIds[0]!), false);
    });

    it('where returning undefined short-circuits to empty/zero', async () => {
      db.segments.define('emptyByDesign', {
        where: () => undefined,
      });
      assert.equal(await db.segments.size('emptyByDesign'), 0);
      assert.deepEqual(await db.segments.ids('emptyByDesign'), []);
      assert.equal(await db.segments.has('emptyByDesign', 'anything'), false);
    });

    it('forEach pages through where-based segments without loading all ids', async () => {
      db.segments.define('whereAll', {
        where: ({ tables }) => gte(tables.users.level, 1),
      });
      const seen: string[] = [];
      await db.segments.forEach('whereAll', (uid) => { seen.push(uid); }, { pageSize: 2 });
      // 5 users seeded in beforeEach (3 newbies + 2 vets)
      assert.equal(seen.length, 5);
      assert.equal(new Set(seen).size, 5);
    });

    it('rejects definitions with both or neither of where/resolve', () => {
      assert.throws(
        // @ts-expect-error — both where and resolve set; the type union forbids this
        () => db.segments.define('both', {
          where: () => undefined,
          resolve: async () => [],
        }),
        /must provide exactly one of 'where' or 'resolve'/,
      );
      assert.throws(
        // @ts-expect-error — neither set
        () => db.segments.define('neither', {}),
        /must provide exactly one of 'where' or 'resolve'/,
      );
    });

    it('reflects state changes between calls (no stale caching at the service level)', async () => {
      assert.equal(await db.segments.size('highLevel'), 2);

      // Promote a low-level player and re-query
      const lowIds = await db.segments.ids('lowLevel');
      await db.drizzle.update(users).set({ level: 99 }).where(eq(users.id, lowIds[0]!));

      assert.equal(await db.segments.size('highLevel'), 3);
      assert.equal(await db.segments.size('lowLevel'), 2);
    });
  });
}

// Compile-time type tests — dialect-independent, so registered once under
// sqlite shape only. These never .boot() a database; they just lock in
// generic propagation through the segment-definer types.
describe('SegmentsService — type-level (sqlite shape)', () => {
  const users = schemaFactories.sqlite.users('users', {
    level: sqliteInteger('level').default(1),
    nickname: sqliteText('nickname'),
  });

  it('createSegmentDefiner<S>() strictly types tables + drizzle inside resolve', () => {
    const localSchema = { users };
    const defineForSchema = createSegmentDefiner<typeof localSchema>();

    const seg = defineForSchema('typed', {
      resolve: async ({ drizzle, tables }) => {
        const _level = tables.users.level;
        const rows = await drizzle
          .select({ id: tables.users.id })
          .from(tables.users)
          .where(eq(tables.users.level, 1));
        // @ts-expect-error — `nonexistent` is not a column on the custom users table
        const _bad = tables.users.nonexistent;
        // @ts-expect-error — `notATable` is not in the schema barrel
        const _bad2 = tables.notATable;
        return rows.map((r) => r.id);
      },
    });

    assert.equal(seg.id, 'typed');
  });

  it('db.drizzle is strictly typed against the GameDatabase schema generic', () => {
    // Type-only assertion: never .boot()s, never runs queries.
    const db = new GameDatabase({ schemas: { users } });
    type Row = Awaited<ReturnType<typeof db.drizzle.select<{ id: typeof users.id; level: typeof users.level }>>>;
    // The above type alias compiling is the assertion. `db` is also used
    // below so TS doesn't drop it.
    assert.ok(db.tables.users);
  });
});
