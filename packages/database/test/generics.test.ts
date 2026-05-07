import assert from 'node:assert';
import { describe, it } from 'node:test';
import { integer, text } from 'drizzle-orm/sqlite-core';
import type { InferSelectModel } from 'drizzle-orm';
import { GameDatabase, tables } from '../src/index.ts';
import type { AuthService } from '../src/services/AuthService.ts';
import type { ConfigService } from '../src/services/ConfigService.ts';
import type { ItemsService } from '../src/services/ItemsService.ts';

/**
 * Compile-time tests for the GameDatabase<S> generic. Each declaration is
 * type-checked at build time; the runtime body is just a placeholder so
 * `node:test` reports them as passing. If a regression breaks generic
 * propagation through services, tsc fails before tests can even start.
 *
 * These tests are intentionally non-executing — they construct GameDatabase
 * instances purely to capture the resulting type and never call .boot().
 */

type AssertEqual<A, B> =
  (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false;

type Expect<T extends true> = T;

describe('GameDatabase<S> generic propagation', () => {
  it('flows custom users columns through AuthService<T>', () => {
    const users = tables.sqlite.users('users', {
      displayName: text('display_name'),
      level: integer('level').default(1),
    });

    const db = new GameDatabase({ schemas: { users } });

    type AuthT = typeof db.auth;
    type Row = InferSelectModel<typeof users>;

    type _AuthIsCustom = Expect<AssertEqual<AuthT, AuthService<typeof users>>>;
    type _RowHasCustomCols = Expect<
      AssertEqual<
        // pull the columns we care about out of the inferred row
        Pick<Row, 'displayName' | 'level' | 'email'>,
        { displayName: string | null; level: number | null; email: string | null }
      >
    >;

    assert.ok(db);
  });

  it('falls back to loose shape for un-overridden slots', () => {
    const users = tables.sqlite.users('users', {
      displayName: text('display_name'),
    });

    const db = new GameDatabase({ schemas: { users } });

    // configs wasn't overridden — service stays on the loose default
    type ConfigT = typeof db.config;
    type _ConfigIsDefault = Expect<AssertEqual<ConfigT, ConfigService>>;

    assert.ok(db);
  });

  it('threads multiple table generics independently', () => {
    const items = tables.sqlite.items('items', {
      rarity: text('rarity'),
    });
    const playerItems = tables.sqlite.playerItems('player_items', {
      enchantLevel: integer('enchant_level').default(0),
    });

    const db = new GameDatabase({ schemas: { items, playerItems } });

    type ItemsT = typeof db.items;
    type _ItemsHasBothGenerics = Expect<
      AssertEqual<ItemsT, ItemsService<typeof items, typeof playerItems>>
    >;

    assert.ok(db);
  });

  it('with no schemas, every service stays on its loose default', () => {
    const db = new GameDatabase();

    type _AuthIsDefault = Expect<AssertEqual<typeof db.auth, AuthService>>;
    type _ConfigIsDefault = Expect<AssertEqual<typeof db.config, ConfigService>>;

    assert.ok(db);
  });
});
