/**
 * Tests for the improved ConfigService:
 *   - typed registry via `defineConfigs`
 *   - in-memory cache (first read hits DB, subsequent return cached)
 *   - cross-instance invalidation via Colyseus Presence pub/sub
 *   - subscribe() API for reactive code
 *
 * Uses zod as the Standard Schema validator. Any validator that
 * implements `StandardSchemaV1` works equivalently — valibot, yup,
 * arktype, hand-rolled — zod just makes the test fixtures terse.
 *
 * Runs against the same sqlite + pglite matrix as the other DB tests.
 */
import assert from 'assert';
import { describe, it, beforeEach, afterEach } from 'node:test';
import { LocalPresence } from '@colyseus/core';
import { z } from 'zod';
import { GameDatabase, defineConfigs } from '../src/index.ts';
import { BACKENDS, type Backend } from './backends.ts';

const registry = defineConfigs({
  matchmaking: z.object({
    minPlayers: z.number().int().default(2),
    maxPlayers: z.number().int().default(10),
  }).default({ minPlayers: 2, maxPlayers: 10 }),
  features: z.object({
    doubleXP: z.boolean().default(false),
  }).default({ doubleXP: false }),
});

async function newDb(
  backend: Backend,
  opts: { presence?: LocalPresence; registry?: any } = {},
): Promise<GameDatabase> {
  const db = backend.newDb({
    configsRegistry: opts.registry,
    presence: opts.presence,
  });
  await db.boot();
  return db;
}

for (const backend of BACKENDS) {
  describe(`ConfigService — typed registry (${backend.name})`, () => {
    let db: GameDatabase<any, any, typeof registry>;
    beforeEach(async () => { db = await newDb(backend, { registry }) as any; });
    afterEach(async () => { await backend.cleanupOne(db); });

    it('falls back to schema defaults when no row exists', async () => {
      const mm = await db.configs.get('matchmaking');
      assert.deepEqual(mm, { minPlayers: 2, maxPlayers: 10 });
      const features = await db.configs.get('features');
      assert.deepEqual(features, { doubleXP: false });
    });

    it('round-trips a valid value via set/get', async () => {
      await db.configs.set('matchmaking', { minPlayers: 4, maxPlayers: 16 });
      const mm = await db.configs.get('matchmaking');
      assert.deepEqual(mm, { minPlayers: 4, maxPlayers: 16 });
    });

    it('throws on validation failure', async () => {
      await assert.rejects(
        // @ts-expect-error - intentional bad value for the test
        () => db.configs.set('matchmaking', { minPlayers: 'two', maxPlayers: 10 }),
        /validation failed for "matchmaking"/,
      );
    });

    it('untyped keys still work via the loose overload', async () => {
      await db.configs.set('untyped:flag', 'hello');
      assert.equal(await db.configs.get('untyped:flag'), 'hello');
      assert.equal(await db.configs.get('missing'), null);
    });

    it('getAll fills in defaults for registered keys not yet stored', async () => {
      await db.configs.set('features', { doubleXP: true });
      const all = await db.configs.getAll();
      assert.deepEqual(all.features, { doubleXP: true });
      // matchmaking row wasn't written but defaults flow through
      assert.deepEqual(all.matchmaking, { minPlayers: 2, maxPlayers: 10 });
    });

    it('delete invalidates the cache and notifies subscribers with defaults', async () => {
      await db.configs.set('features', { doubleXP: true });
      let received: any = null;
      db.configs.subscribe('features', (val) => { received = val; });
      await db.configs.delete('features');
      assert.deepEqual(received, { doubleXP: false }, 'subscriber sees the schema default');
    });
  });

  describe(`ConfigService — in-memory cache (${backend.name})`, () => {
    let db: GameDatabase<any, any, typeof registry>;
    beforeEach(async () => { db = await newDb(backend, { registry }) as any; });
    afterEach(async () => { await backend.cleanupOne(db); });

    it('caches reads after the first DB hit', async () => {
      // Seed via service so the value is also in the cache.
      await db.configs.set('matchmaking', { minPlayers: 3, maxPlayers: 8 });

      // Mutate the row out-of-band — directly via drizzle, bypassing the service.
      await db.drizzle
        .update(db.tables.configs)
        .set({ value: { minPlayers: 99, maxPlayers: 99 } });

      // Cached value should still return the original.
      const cached = await db.configs.get('matchmaking');
      assert.deepEqual(cached, { minPlayers: 3, maxPlayers: 8 });
    });

    it('refreshes cache when set() is called locally', async () => {
      await db.configs.set('matchmaking', { minPlayers: 3, maxPlayers: 8 });
      await db.configs.set('matchmaking', { minPlayers: 5, maxPlayers: 12 });
      assert.deepEqual(
        await db.configs.get('matchmaking'),
        { minPlayers: 5, maxPlayers: 12 },
      );
    });
  });

  describe(`ConfigService — subscribe() (${backend.name})`, () => {
    let db: GameDatabase<any, any, typeof registry>;
    beforeEach(async () => { db = await newDb(backend, { registry }) as any; });
    afterEach(async () => { await backend.cleanupOne(db); });

    it('fires subscribers when set() is called locally', async () => {
      const received: any[] = [];
      db.configs.subscribe('features', (val) => { received.push(val); });

      await db.configs.set('features', { doubleXP: true });
      await db.configs.set('features', { doubleXP: false });

      assert.deepEqual(received, [
        { doubleXP: true },
        { doubleXP: false },
      ]);
    });

    it('returns an unsubscribe function that stops the listener', async () => {
      const received: any[] = [];
      const unsubscribe = db.configs.subscribe('features', (val) => { received.push(val); });

      await db.configs.set('features', { doubleXP: true });
      unsubscribe();
      await db.configs.set('features', { doubleXP: false });

      assert.deepEqual(received, [{ doubleXP: true }], 'second set should not fire callback');
    });
  });

  describe(`ConfigService — Presence pub/sub (${backend.name})`, () => {
    it('cross-instance: set() on instance A propagates to instance B', async () => {
      // One shared Presence simulates a multi-process setup.
      const presence = new LocalPresence();
      const dbA = await newDb(backend, { registry, presence }) as GameDatabase<any, any, typeof registry>;
      const dbB = await newDb(backend, { registry, presence }) as GameDatabase<any, any, typeof registry>;

      try {
        let received: any = null;
        dbB.configs.subscribe('features', (val) => { received = val; });

        await dbA.configs.set('features', { doubleXP: true });

        // Presence dispatch is synchronous-ish in LocalPresence; give the
        // event loop a tick to be safe.
        await new Promise((r) => setImmediate(r));

        assert.deepEqual(received, { doubleXP: true });

        // Cache on dbB should now hold the new value — get() returns from
        // cache without touching dbB's own (empty) row.
        assert.deepEqual(await dbB.configs.get('features'), { doubleXP: true });
      } finally {
        await backend.cleanupOne(dbA);
        await backend.cleanupOne(dbB);
      }
    });

    it('shutdown unsubscribes from the presence channel', async () => {
      const presence = new LocalPresence();
      const db = await newDb(backend, { registry, presence });

      // Before shutdown — there should be a subscription on the channel.
      const channelsBefore = await presence.channels();
      assert.ok(
        channelsBefore.some((c) => c.includes('configs:update')),
        'invalidation channel should be active before shutdown',
      );

      await backend.cleanupOne(db);

      const channelsAfter = await presence.channels();
      assert.ok(
        !channelsAfter.some((c) => c.includes('configs:update')),
        'invalidation channel should be released after shutdown',
      );
    });
  });
}
