import assert from 'assert';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import { describe, it, beforeEach, afterEach } from 'node:test';
import { GameDatabase, VersionConflictError } from '../src/index.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * End-to-end coverage for every service GameDatabase exposes.
 *
 * Runs against TWO backends:
 *   - sqlite (file-backed, default)
 *   - pglite (embedded Wasm Postgres via @electric-sql/pglite)
 *
 * Each backend gets its own top-level describe so failures clearly identify
 * which dialect broke. PGlite gives us pg-flavor coverage (jsonb, GREATEST,
 * boolean, serial PKs, timestamp) without needing a real Postgres server.
 */

interface Backend {
  name: string;
  newDb(): GameDatabase;
  cleanupOne(db: GameDatabase): Promise<void>;
}

const BACKENDS: Backend[] = [
  {
    name: 'sqlite',
    newDb() {
      const dbPath = path.join(__dirname, `.t-sqlite-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
      const db = new GameDatabase({ connectionString: dbPath });
      (db as any).__cleanupPath = dbPath;
      return db;
    },
    async cleanupOne(db) {
      await db.shutdown();
      const dbPath = (db as any).__cleanupPath as string;
      for (const ext of ['', '-shm', '-wal']) {
        try { fs.unlinkSync(dbPath + ext); } catch { /* ignore */ }
      }
    },
  },
  {
    name: 'pglite',
    newDb() {
      const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'colyseus-pglite-'));
      const db = new GameDatabase({ connectionString: `pglite://${dataDir}` });
      (db as any).__cleanupPath = dataDir;
      return db;
    },
    async cleanupOne(db) {
      await db.shutdown();
      const dataDir = (db as any).__cleanupPath as string;
      try { fs.rmSync(dataDir, { recursive: true, force: true }); } catch { /* ignore */ }
    },
  },
];

for (const backend of BACKENDS) {
  let db: GameDatabase;

  async function fresh(): Promise<GameDatabase> {
    db = backend.newDb();
    await db.boot();
    return db;
  }

  describe(`@colyseus/database (${backend.name})`, () => {
    describe('GameDatabase', () => {
      beforeEach(async () => { await fresh(); });
      afterEach(async () => { await backend.cleanupOne(db); });

      it('exposes drizzle client and resolved tables after boot', () => {
        assert.ok(db.drizzle, 'drizzle client should be set');
        assert.ok(db.tables, 'tables map should be set');
        const expected = ['users', 'configs', 'cloudSaves', 'leaderboards', 'leaderboardEntries',
          'items', 'playerItems', 'timedEvents', 'analyticsEvents', 'userRoles', 'modAssignments'];
        for (const name of expected) {
          assert.ok(db.tables[name], `tables.${name} should be defined`);
        }
      });

      it('exposes one service instance per feature', () => {
        assert.ok(db.auth);
        assert.ok(db.config);
        assert.ok(db.saves);
        assert.ok(db.leaderboards);
        assert.ok(db.items);
        assert.ok(db.events);
        assert.ok(db.analytics);
        assert.ok(db.moderation);
      });
    });

    describe('AuthService.settings', () => {
      beforeEach(async () => { await fresh(); });
      afterEach(async () => { await backend.cleanupOne(db); });

      it('returns @colyseus/auth-shaped callbacks', () => {
        const s = db.auth.settings;
        assert.equal(typeof s.onFindUserByEmail, 'function');
        assert.equal(typeof s.onRegisterWithEmailAndPassword, 'function');
        assert.equal(typeof s.onRegisterAnonymously, 'function');
      });

      it('registers anonymous users via the auth callback', async () => {
        const s = db.auth.settings;
        const u: any = await s.onRegisterAnonymously!({} as any);
        assert.ok(u.id, 'anonymous user has an id');
        assert.equal(u.anonymous, true);
      });

      it('ban / unban / isBanned round-trip', async () => {
        // Seed a user via the auth flow so the row has all defaults.
        const u: any = await db.auth.settings.onRegisterAnonymously!({} as any);

        // Initial state
        const before = await db.auth.isBanned(u.id);
        assert.equal(before.banned, false);

        // Permanent ban (no `until`)
        await db.auth.ban(u.id, { reason: 'fraud' });
        const banned = await db.auth.isBanned(u.id);
        assert.equal(banned.banned, true);
        if (banned.banned) {
          assert.equal(banned.reason, 'fraud');
          assert.ok(banned.until.getTime() > Date.now() + 86_400_000);
        }

        // Unban clears state
        await db.auth.unban(u.id);
        assert.equal((await db.auth.isBanned(u.id)).banned, false);
      });

      it('isBanned reports false once the expiry passes', async () => {
        const u: any = await db.auth.settings.onRegisterAnonymously!({} as any);
        const past = new Date(Date.now() - 60_000);
        await db.auth.ban(u.id, { reason: 'cool down', until: past });
        const r = await db.auth.isBanned(u.id);
        assert.equal(r.banned, false);
      });

      it('findByEmail rejects banned users (login enforcement)', async () => {
        const s = db.auth.settings;
        // Register the user with email
        await s.onRegisterWithEmailAndPassword!('a@b.com', 'hash', {} as any);
        // Confirm sign-in works pre-ban
        const pre = await s.onFindUserByEmail!('a@b.com');
        assert.ok(pre, 'pre-ban findByEmail returns user');

        // Ban through the public API
        await db.auth.ban((pre as any).id, { reason: 'TOS' });

        // Sign-in path now refuses
        const post = await s.onFindUserByEmail!('a@b.com');
        assert.equal(post, null, 'banned user no longer signs in');
      });
    });

    describe('ConfigService', () => {
      beforeEach(async () => { await fresh(); });
      afterEach(async () => { await backend.cleanupOne(db); });

      it('round-trips JSON values via get/set', async () => {
        await db.config.set('xp_multiplier', 2);
        assert.equal(await db.config.get<number>('xp_multiplier'), 2);

        await db.config.set('flags', { double_xp: true });
        assert.deepEqual(await db.config.get('flags'), { double_xp: true });
      });

      it('returns null for missing keys', async () => {
        assert.equal(await db.config.get('nonexistent'), null);
      });

      it('listAll returns every key', async () => {
        await db.config.set('a', 1);
        await db.config.set('b', 'two');
        const all = await db.config.getAll();
        assert.equal(all.a, 1);
        assert.equal(all.b, 'two');
      });
    });

    describe('CloudSaveService', () => {
      beforeEach(async () => { await fresh(); });
      afterEach(async () => { await backend.cleanupOne(db); });

      it('save+load round-trips data and bumps version', async () => {
        const r1 = await db.saves.save('u1', 0, { hp: 100 });
        assert.equal(r1.version, 1);
        const r2 = await db.saves.save('u1', 0, { hp: 90 });
        assert.equal(r2.version, 2);

        const loaded = await db.saves.load('u1', 0);
        assert.deepEqual(loaded?.data, { hp: 90 });
        assert.equal(loaded?.version, 2);
      });

      it('rejects stale optimistic writes with VersionConflictError', async () => {
        await db.saves.save('u1', 0, { hp: 100 });        // v1
        await db.saves.save('u1', 0, { hp: 90 }, 1);       // v2 — passes
        await assert.rejects(
          db.saves.save('u1', 0, { hp: 80 }, 1),           // expectedVersion still 1, but row is v2
          VersionConflictError,
        );
      });

      it('listSlots returns one row per occupied slot', async () => {
        await db.saves.save('u1', 0, { a: 1 });
        await db.saves.save('u1', 1, { b: 2 });
        const slots = await db.saves.listSlots('u1');
        assert.equal(slots.length, 2);
        assert.deepEqual(slots.map((s) => s.slot).sort(), [0, 1]);
      });
    });

    describe('LeaderboardsService', () => {
      beforeEach(async () => { await fresh(); });
      afterEach(async () => { await backend.cleanupOne(db); });

      it('keep-best semantics on submit', async () => {
        await db.leaderboards.ensure('global', 'Global');
        await db.leaderboards.submit('global', 'u1', 100);
        await db.leaderboards.submit('global', 'u1', 50);   // ignored
        await db.leaderboards.submit('global', 'u1', 175);  // new high
        const top = await db.leaderboards.top('global', 10);
        assert.equal(top.length, 1);
        assert.equal(top[0]!.score, 175);
      });

      it('top returns DESC by score', async () => {
        await db.leaderboards.ensure('global');
        await db.leaderboards.submit('global', 'u1', 100);
        await db.leaderboards.submit('global', 'u2', 200);
        await db.leaderboards.submit('global', 'u3', 150);
        const top = await db.leaderboards.top('global', 10);
        assert.deepEqual(top.map((e) => e.score), [200, 150, 100]);
      });

      it('aroundMe windows above + me + below', async () => {
        await db.leaderboards.ensure('global');
        await db.leaderboards.submit('global', 'u1', 100);
        await db.leaderboards.submit('global', 'u2', 200);
        await db.leaderboards.submit('global', 'u3', 150);
        const around = await db.leaderboards.aroundMe('global', 'u3', 1);
        assert.deepEqual(around.map((e) => e.score), [200, 150, 100]);
      });

      it('seasons isolate score tables', async () => {
        await db.leaderboards.ensure('global');
        await db.leaderboards.submit('global', 'u1', 100);
        await db.leaderboards.submit('global', 'u1', 999, 'season-1');
        const global = await db.leaderboards.top('global', 10);
        const season = await db.leaderboards.top('global', 10, 'season-1');
        assert.equal(global.length, 1);
        assert.equal(global[0]!.score, 100);
        assert.equal(season.length, 1);
        assert.equal(season[0]!.score, 999);
      });
    });

    describe('ItemsService', () => {
      beforeEach(async () => { await fresh(); });
      afterEach(async () => { await backend.cleanupOne(db); });

      it('grant accumulates qty', async () => {
        await db.items.defineItem('sword', 'Iron Sword', 'weapon');
        await db.items.grant('u1', 'sword', 2);
        await db.items.grant('u1', 'sword', 1);
        const inv = await db.items.listForUser('u1');
        assert.equal(inv[0]!.qty, 3);
      });

      it('revoke decrements; deletes on hitting 0', async () => {
        await db.items.defineItem('gem', 'Ruby');
        await db.items.grant('u1', 'gem', 5);
        await db.items.revoke('u1', 'gem', 2);
        let inv = await db.items.listForUser('u1');
        assert.equal(inv[0]!.qty, 3);
        await db.items.revoke('u1', 'gem', 100); // beyond holding
        inv = await db.items.listForUser('u1');
        assert.equal(inv.length, 0);
      });
    });

    describe('TimedEventsService', () => {
      beforeEach(async () => { await fresh(); });
      afterEach(async () => { await backend.cleanupOne(db); });

      it('isActive returns true only inside the window', async () => {
        const past = new Date(Date.now() - 60_000);
        const future = new Date(Date.now() + 60_000);
        const wayFuture = new Date(Date.now() + 24 * 3600_000);

        await db.events.schedule('double_xp_now', 'Double XP', past, future);
        await db.events.schedule('double_xp_later', 'Future', future, wayFuture);

        assert.equal(await db.events.isActive('double_xp_now'), true);
        assert.equal(await db.events.isActive('double_xp_later'), false);
      });

      it('active() returns currently-running events', async () => {
        const past = new Date(Date.now() - 60_000);
        const future = new Date(Date.now() + 60_000);
        const wayFuture = new Date(Date.now() + 24 * 3600_000);

        await db.events.schedule('on', 'On', past, future);
        await db.events.schedule('off', 'Off', future, wayFuture);
        const active = await db.events.active();
        assert.deepEqual(active.map((e) => e.id), ['on']);
      });

      it('cancel removes the event', async () => {
        const past = new Date(Date.now() - 60_000);
        const future = new Date(Date.now() + 60_000);
        await db.events.schedule('e1', 'E', past, future);
        assert.equal(await db.events.isActive('e1'), true);
        await db.events.cancel('e1');
        assert.equal(await db.events.isActive('e1'), false);
      });
    });

    describe('AnalyticsService', () => {
      beforeEach(async () => { await fresh(); });
      afterEach(async () => { await backend.cleanupOne(db); });

      it('track persists rows', async () => {
        await db.analytics.track('login', 'u1', { source: 'cta' });
        await db.analytics.track('login', 'u2');
        const rows = await db.drizzle.select().from(db.tables.analyticsEvents);
        assert.equal(rows.length, 2);
      });

      it('funnel narrows step-by-step', async () => {
        await db.analytics.track('step_a', 'u1');
        await db.analytics.track('step_a', 'u2');
        await db.analytics.track('step_b', 'u1');
        const f = await db.analytics.funnel(['step_a', 'step_b']);
        assert.deepEqual(f, [
          { step: 'step_a', users: 2 },
          { step: 'step_b', users: 1 },
        ]);
      });
    });

    describe('ModerationService', () => {
      beforeEach(async () => { await fresh(); });
      afterEach(async () => { await backend.cleanupOne(db); });

      it('admin can do anything', async () => {
        await db.moderation.setRole('admin1', 'admin');
        assert.equal(await db.moderation.can('admin1', 'delete', 'users'), true);
        assert.equal(await db.moderation.can('admin1', 'create', 'configs'), true);
      });

      it('mod scoped to assigned collections; cannot delete', async () => {
        await db.moderation.assignMod('mod1', 'guilds');
        assert.equal(await db.moderation.getRole('mod1'), 'mod');
        assert.equal(await db.moderation.can('mod1', 'update', 'guilds'), true);
        assert.equal(await db.moderation.can('mod1', 'delete', 'guilds'), false);
        assert.equal(await db.moderation.can('mod1', 'update', 'users'), false);
      });

      it('mod cannot touch role tables even if assigned', async () => {
        await db.moderation.assignMod('mod1', 'colyseus_user_roles');
        assert.equal(await db.moderation.can('mod1', 'update', 'colyseus_user_roles'), false);
      });

      it('default role is user (read-only)', async () => {
        assert.equal(await db.moderation.getRole('unknown'), 'user');
        assert.equal(await db.moderation.can('unknown', 'list', 'whatever'), true);
        assert.equal(await db.moderation.can('unknown', 'create', 'whatever'), false);
      });
    });
  });
}
