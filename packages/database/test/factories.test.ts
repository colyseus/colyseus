import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it, beforeEach, afterEach } from 'node:test';
import { text, integer } from 'drizzle-orm/sqlite-core';
import { eq } from 'drizzle-orm';
import { GameDatabase, tables } from '../src/index.ts';

/**
 * Verify the table factories produce drizzle tables that:
 *  - include all base columns (so services keep working)
 *  - include user-supplied extras (so custom columns persist + read back)
 *  - keep composite-PK constraints intact (cloudSaves, etc.)
 */

let db: GameDatabase;
let dbPath: string;

beforeEach(() => {
  dbPath = path.join(os.tmpdir(), `colyseus-fac-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
});

afterEach(async () => {
  if (db) { await db.shutdown(); }
  for (const ext of ['', '-shm', '-wal']) {
    try { fs.unlinkSync(dbPath + ext); } catch { /* ignore */ }
  }
});

describe('tables.sqlite factory', () => {
  it('users(): spreads base columns + extras', async () => {
    const users = tables.sqlite.users('users', {
      displayName: text('display_name'),
      level: integer('level').notNull().default(1),
    });
    db = new GameDatabase({ connectionString: dbPath, schemas: { users } });
    await db.boot();

    // All base column names should still be addressable as drizzle columns
    for (const c of ['id', 'email', 'passwordHash', 'anonymous', 'anonymousId', 'createdAt', 'updatedAt']) {
      assert.ok((users as any)[c], `users.${c} should exist`);
    }
    // Extras present too
    assert.ok((users as any).displayName);
    assert.ok((users as any).level);

    // End-to-end: insert a row with extras + read back
    await db.drizzle.insert(users).values({ id: 'u1', displayName: 'Alice', level: 5 });
    const rows = await db.drizzle.select().from(users).where(eq((users as any).id, 'u1'));
    assert.equal(rows[0].displayName, 'Alice');
    assert.equal(rows[0].level, 5);
  });

  it('cloudSaves(): preserves composite primary key on (userId, slot)', async () => {
    const cloudSaves = tables.sqlite.cloudSaves('saves', {
      tag: text('tag'),
    });
    db = new GameDatabase({ connectionString: dbPath, schemas: { cloudSaves } });
    await db.boot();

    // Use the DB to verify the composite PK is enforced — insert two
    // rows with same (userId, slot) different tag, second should error.
    await db.drizzle.insert(cloudSaves).values({ userId: 'u1', slot: 0, data: { hp: 1 } as any, tag: 'a' });
    await assert.rejects(
      db.drizzle.insert(cloudSaves).values({ userId: 'u1', slot: 0, data: { hp: 2 } as any, tag: 'b' }),
      /UNIQUE|primary key/i,
    );
  });

  it('analyticsEvents(): autoincrement PK passes through', async () => {
    const analyticsEvents = tables.sqlite.analyticsEvents('events', {
      sessionId: text('session_id'),
    });
    db = new GameDatabase({ connectionString: dbPath, schemas: { analyticsEvents } });
    await db.boot();

    await db.drizzle.insert(analyticsEvents).values({ name: 'login', sessionId: 's-1' });
    await db.drizzle.insert(analyticsEvents).values({ name: 'login', sessionId: 's-2' });
    const rows = await db.drizzle.select().from(analyticsEvents);
    assert.equal(rows.length, 2);
    // Two distinct auto-incremented ids
    assert.notEqual(rows[0].id, rows[1].id);
  });

  it('round-trips through services with custom columns', async () => {
    const users = tables.sqlite.users('users', {
      displayName: text('display_name'),
    });
    db = new GameDatabase({ connectionString: dbPath, schemas: { users } });
    await db.boot();

    // Write with custom column via raw drizzle...
    await db.drizzle.insert(users).values({ id: 'u1', email: 'a@b.com', displayName: 'Alice' });
    // ...and read back via the service. Custom columns are preserved on the row.
    const found: any = await db.auth.settings.onFindUserByEmail!('a@b.com');
    assert.ok(found);
    assert.equal(found.email, 'a@b.com');
    assert.equal(found.displayName, 'Alice');
  });
});

describe('tables.pg factory shape', async () => {
  // pg column builders are dialect-specific; import them locally
  const { text: pgText } = await import('drizzle-orm/pg-core');

  it('produces a pgTable with both base + extras (no DB needed for shape)', () => {
    const users = tables.pg.users('my_users', {
      displayName: pgText('display_name'),
    });
    // Sanity: drizzle's pg tables expose pg-specific column types — for example
    // `id` (declared in `userColumns` as text PK with $defaultFn). The `email`
    // column should be an AnyColumn-like object; just check shape.
    assert.ok((users as any).id);
    assert.ok((users as any).email);
    assert.ok((users as any).displayName, 'extra column displayName');
  });
});
