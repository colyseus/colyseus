/**
 * SegmentsService — declarative cohort resolution.
 *
 * Verifies the v1 contract: segments are defined in code, the service runs
 * each segment's resolver against the live DB on demand, and the standard
 * accessors (list/size/ids/has/forEach) work.
 */
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, beforeEach, afterEach } from 'node:test';
import { eq, gte } from 'drizzle-orm';
import { GameDatabase, defineSegment, tables as schemaFactories } from '../src/index.ts';
import { integer, text } from 'drizzle-orm/sqlite-core';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

let dbPath: string;
let db: GameDatabase;

function freshDbPath(): string {
  return path.join(__dirname, `.seg-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
}

async function cleanup() {
  if (db) { await db.shutdown(); }
  for (const ext of ['', '-shm', '-wal']) {
    try { fs.unlinkSync(dbPath + ext); } catch { /* ignore */ }
  }
}

describe('SegmentsService', () => {
  // Custom users table with `level` so we can write a non-trivial segment.
  const users = schemaFactories.sqlite.users('users', {
    level: integer('level').default(1),
  });

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
    dbPath = freshDbPath();
    db = new GameDatabase({
      connectionString: dbPath,
      schemas: { users },
      segments: [lowLevel, highLevel],
    });
    await db.boot();

    // Seed: 3 newbies at level 1, 2 vets at level 12 + 50.
    await Promise.all([
      db.auth.settings.onRegisterAnonymously?.({}),
      db.auth.settings.onRegisterAnonymously?.({}),
      db.auth.settings.onRegisterAnonymously?.({}),
    ]);
    const vet1 = (await db.auth.settings.onRegisterAnonymously?.({})) as { id: string };
    const vet2 = (await db.auth.settings.onRegisterAnonymously?.({})) as { id: string };
    const conn = (db as any).ownedConnection;
    conn.prepare('UPDATE users SET level = 12 WHERE id = ?').run(vet1.id);
    conn.prepare('UPDATE users SET level = 50 WHERE id = ?').run(vet2.id);
  });

  afterEach(cleanup);

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
    db = new GameDatabase({
      connectionString: freshDbPath(),
      schemas: { users },
      segments: [lowLevel, lowLevel],
    });
    await assert.rejects(() => db.boot(), /duplicate segment id: lowLevel/);
  });

  it('reflects state changes between calls (no stale caching at the service level)', async () => {
    assert.equal(await db.segments.size('highLevel'), 2);

    // Promote a low-level player and re-query
    const lowIds = await db.segments.ids('lowLevel');
    const conn = (db as any).ownedConnection;
    conn.prepare('UPDATE users SET level = 99 WHERE id = ?').run(lowIds[0]);

    assert.equal(await db.segments.size('highLevel'), 3);
    assert.equal(await db.segments.size('lowLevel'), 2);
  });
});
