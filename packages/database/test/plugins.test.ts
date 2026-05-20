/**
 * Phase 2 unit tests for the database-driven room plugins. Each suite
 * uses `attachToTestRoom` to inject a minimal room stub — we exercise
 * lifecycle hooks + public methods in isolation, without spinning up a
 * Colyseus server.
 *
 * Runs against the same sqlite + pglite matrix as the other DB tests.
 */
import assert from 'node:assert';
import { describe, it, beforeEach, afterEach } from 'node:test';
import { attachToTestRoom } from '@colyseus/core';

import { GameDatabase } from '../src/index.ts';
import { AnalyticsPlugin, CloudSavesPlugin, LeaderboardsPlugin } from '../src/plugins/index.ts';
import { BACKENDS, type Backend } from './backends.ts';

async function newDb(backend: Backend): Promise<GameDatabase> {
  const db = backend.newDb();
  await db.boot();
  return db;
}

for (const backend of BACKENDS) {
  describe(`AnalyticsPlugin (${backend.name})`, () => {
    let db: GameDatabase;
    beforeEach(async () => { db = await newDb(backend); });
    afterEach(async () => { await backend.cleanupOne(db); });

    it('tracks join + leave + dispose by default and reads back via retention()', async () => {
      const plugin = new AnalyticsPlugin({ database: db, prefix: 'arena' });
      attachToTestRoom(plugin, { roomId: 'r1', clients: [] as any });

      const client = { userId: 'u1', auth: {} };
      await plugin.onJoin!(client as any);
      await plugin.onLeave!(client as any, 1000);
      await plugin.onDispose!();

      // Pull rows directly via drizzle to assert what was written.
      const rows = await db.drizzle
        .select()
        .from(db.tables.analyticsEvents);
      const names = rows.map((r: any) => r.name).sort();
      assert.deepEqual(names, ['arena.dispose', 'arena.join', 'arena.leave']);
    });

    it('honors `track: []` to disable all auto-tracking', async () => {
      const plugin = new AnalyticsPlugin({ database: db, track: [] });
      attachToTestRoom(plugin, { roomId: 'r2', clients: [] as any });

      await plugin.onJoin!({ userId: 'u1' } as any);
      await plugin.onLeave!({ userId: 'u1' } as any, 1000);
      await plugin.onDispose!();

      const rows = await db.drizzle
        .select()
        .from(db.tables.analyticsEvents);
      assert.equal(rows.length, 0, 'no auto-tracked events when track is []');
    });

    it('manual track() applies the configured prefix', async () => {
      const plugin = new AnalyticsPlugin({ database: db, prefix: 'arena', track: [] });
      attachToTestRoom(plugin, { roomId: 'r3' });

      await plugin.track('round_started', { round: 2 }, 'u9');

      const rows = await db.drizzle
        .select()
        .from(db.tables.analyticsEvents);
      assert.equal(rows.length, 1);
      assert.equal(rows[0]!.name, 'arena.round_started');
      assert.equal(rows[0]!.userId, 'u9');
    });

    it('skips userId when resolveUserId returns null', async () => {
      const plugin = new AnalyticsPlugin({
        database: db,
        resolveUserId: () => null,
      });
      attachToTestRoom(plugin, { roomId: 'r4' });

      await plugin.onJoin!({ userId: 'u1' } as any);

      const rows = await db.drizzle
        .select()
        .from(db.tables.analyticsEvents);
      assert.equal(rows[0]!.userId, null);
    });
  });

  describe(`CloudSavesPlugin (${backend.name})`, () => {
    let db: GameDatabase;
    beforeEach(async () => { db = await newDb(backend); });
    afterEach(async () => { await backend.cleanupOne(db); });

    it('loads on join (apply receives the previously-saved payload)', async () => {
      // Seed a save in the db ahead of time.
      const u = await db.auth.settings.onRegisterAnonymously!({} as any) as { id: string };
      await db.saves.save(u.id, { hp: 75 });

      let applied: any = null;
      const plugin = new CloudSavesPlugin({
        database: db, slot: 0, onJoin: 'load', onLeave: 'none',
        apply: (_room, _client, data) => { applied = data; },
      });
      attachToTestRoom(plugin, { roomId: 'r1' });

      await plugin.onJoin!({ userId: u.id } as any);

      assert.deepEqual(applied, { hp: 75 });
    });

    it('saves on leave (payload becomes the persisted row)', async () => {
      const u = await db.auth.settings.onRegisterAnonymously!({} as any) as { id: string };
      const plugin = new CloudSavesPlugin({
        database: db, slot: 0, onJoin: 'none', onLeave: 'save',
        payload: () => ({ hp: 42 }),
      });
      attachToTestRoom(plugin, { roomId: 'r1' });

      await plugin.onLeave!({ userId: u.id } as any, 1000);

      const saved = await db.saves.load(u.id);
      assert.deepEqual(saved?.data, { hp: 42 });
    });

    it('manualSave / manualLoad bypass the mode toggles', async () => {
      const u = await db.auth.settings.onRegisterAnonymously!({} as any) as { id: string };
      let applied: any = null;
      const plugin = new CloudSavesPlugin({
        database: db, slot: 0,
        onJoin: 'none', onLeave: 'none',  // both disabled
        payload: () => ({ hp: 99 }),
        apply: (_r, _c, data) => { applied = data; },
      });
      attachToTestRoom(plugin, { roomId: 'r1' });

      await plugin.manualSave({ userId: u.id } as any);
      await plugin.manualLoad({ userId: u.id } as any);
      assert.deepEqual(applied, { hp: 99 });
    });

    it('does nothing when the user has no save and apply is set', async () => {
      let called = false;
      const plugin = new CloudSavesPlugin({
        database: db, slot: 0, onJoin: 'load', onLeave: 'none',
        apply: () => { called = true; },
      });
      attachToTestRoom(plugin, { roomId: 'r1' });

      await plugin.onJoin!({ userId: 'no-such-user' } as any);
      assert.equal(called, false, 'apply should not run when no row exists');
    });
  });

  describe(`LeaderboardsPlugin (${backend.name})`, () => {
    let db: GameDatabase;
    beforeEach(async () => { db = await newDb(backend); });
    afterEach(async () => { await backend.cleanupOne(db); });

    it('ensures the board on onCreate (idempotent)', async () => {
      const plugin = new LeaderboardsPlugin({
        database: db, boardId: 'arena', boardName: 'Arena',
      });
      attachToTestRoom(plugin, { roomId: 'r1', clients: [] as any });

      await plugin.onCreate!({});
      await plugin.onCreate!({}); // second call must not throw

      const rows = await db.drizzle
        .select().from(db.tables.leaderboards);
      const row = rows.find((r: any) => r.id === 'arena');
      assert.ok(row, 'board row should exist');
      assert.equal((row as any).name, 'Arena');
    });

    it('submits one score per connected client on dispose', async () => {
      const a = await db.auth.settings.onRegisterAnonymously!({} as any) as { id: string };
      const b = await db.auth.settings.onRegisterAnonymously!({} as any) as { id: string };

      const scoreByClient = new Map<string, number>([
        [a.id, 100],
        [b.id, 80],
      ]);
      const plugin = new LeaderboardsPlugin<any>({
        database: db, boardId: 'arena',
        score: (_room, client) => scoreByClient.get((client as any).userId) ?? null,
      });
      attachToTestRoom(plugin, {
        roomId: 'r1',
        clients: [{ userId: a.id }, { userId: b.id }] as any,
      });

      await plugin.onCreate!({});
      await plugin.onDispose!();

      const top = await db.leaderboards.top('arena', 10);
      assert.equal(top.length, 2);
      assert.equal(top[0]!.userId, a.id); // highest score first
      assert.equal(top[0]!.score, 100);
      assert.equal(top[1]!.score, 80);
    });

    it('submitScore is a one-off entry point regardless of submitOn', async () => {
      const u = await db.auth.settings.onRegisterAnonymously!({} as any) as { id: string };
      const plugin = new LeaderboardsPlugin({
        database: db, boardId: 'arena', submitOn: 'none',
      });
      attachToTestRoom(plugin, { roomId: 'r1', clients: [] as any });

      await plugin.onCreate!({});
      await plugin.submitScore({ userId: u.id } as any, 55);

      const top = await db.leaderboards.top('arena', 10);
      assert.equal(top.length, 1);
      assert.equal(top[0]!.score, 55);
    });

    it('keep-best semantics: a higher mid-match submitScore is not lowered by a lower onDispose score', async () => {
      const u = await db.auth.settings.onRegisterAnonymously!({} as any) as { id: string };
      const plugin = new LeaderboardsPlugin<any>({
        database: db, boardId: 'arena',
        score: () => 30, // end-of-match would put 30
      });
      attachToTestRoom(plugin, {
        roomId: 'r1',
        clients: [{ userId: u.id }] as any,
      });

      await plugin.onCreate!({});
      await plugin.submitScore({ userId: u.id } as any, 90); // earlier high
      await plugin.onDispose!();                              // attempted 30

      const top = await db.leaderboards.top('arena', 1);
      assert.equal(top[0]!.score, 90, 'higher earlier score should remain');
    });
  });
}
