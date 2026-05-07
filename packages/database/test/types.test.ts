import assert from 'node:assert';
import { describe, it } from 'node:test';
import type { GameDatabaseOptions } from '../src/index.ts';

/**
 * Compile-time tests for the discriminated GameDatabaseOptions union.
 *
 * `node:test` only checks runtime behavior, but each `// @ts-expect-error`
 * line is a structural assertion: tsc fails if the line ISN'T flagged as
 * wrong. Each negative case is paired with the matching positive case so
 * a regression in either direction shows up.
 *
 * Note on placement: TypeScript reports object-literal mismatches at the
 * ASSIGNMENT line, not the offending property. So `// @ts-expect-error`
 * goes on the line above `const _bad: GameDatabaseOptions = {`.
 */

describe('GameDatabaseOptions type discrimination', () => {
  it('accepts sqlite-shaped connection options under dialect: sqlite (or omitted)', () => {
    const a: GameDatabaseOptions = {
      dialect: 'sqlite',
      connection: { readOnly: true, enableForeignKeyConstraints: false },
      pragmas: { synchronous: 'NORMAL' },
    };
    const b: GameDatabaseOptions = {
      // dialect omitted → defaults to sqlite typing
      connection: { readOnly: true },
      pragmas: false,
    };
    assert.ok(a && b);
  });

  it('accepts postgres-shaped connection options under dialect: pg', () => {
    const a: GameDatabaseOptions = {
      dialect: 'pg',
      connectionString: 'postgres://localhost:5432/db',
      connection: {
        max: 20,
        ssl: 'require',
        idle_timeout: 30,
        connection: { statement_timeout: 30_000 },
      },
    };
    assert.ok(a);
  });

  it('accepts pglite-shaped connection options under dialect: pglite', () => {
    const a: GameDatabaseOptions = {
      dialect: 'pglite',
      connectionString: 'pglite://./.data',
      connection: { relaxedDurability: true },
    };
    assert.ok(a);
  });

  it('rejects pg-only fields on dialect: sqlite', () => {
    const _bad: GameDatabaseOptions = {
      dialect: 'sqlite',
      // @ts-expect-error — `max` is a postgres-js option, not DatabaseSyncOptions
      connection: { max: 20 },
    };
    assert.ok(_bad);
  });

  it('rejects pglite-only fields on dialect: pg', () => {
    const _bad: GameDatabaseOptions = {
      dialect: 'pg',
      // @ts-expect-error — `relaxedDurability` is a PGlite option, not postgres-js
      connection: { relaxedDurability: true },
    };
    assert.ok(_bad);
  });

  it('rejects sqlite-only fields on dialect: pglite', () => {
    const _bad: GameDatabaseOptions = {
      dialect: 'pglite',
      // @ts-expect-error — readOnly is DatabaseSyncOptions, not PGliteOptions
      connection: { readOnly: true },
    };
    assert.ok(_bad);
  });

  it('rejects pragmas on dialect: pg', () => {
    // @ts-expect-error — pragmas is sqlite-only (typed as `never` on pg branch)
    const _bad: GameDatabaseOptions = {
      dialect: 'pg',
      pragmas: { foreign_keys: 'ON' },
    };
    assert.ok(_bad);
  });

  it('rejects pragmas on dialect: pglite', () => {
    const _bad: GameDatabaseOptions = {
      dialect: 'pglite',
      // @ts-expect-error — pragmas is sqlite-only (typed as `never` on pglite branch)
      pragmas: false,
    };
    assert.ok(_bad);
  });

  it('rejects ssl on omitted-dialect (defaults to sqlite)', () => {
    // @ts-expect-error — without dialect, narrows to sqlite; ssl isn't a DatabaseSyncOptions key
    const _bad: GameDatabaseOptions = {
      connection: { ssl: 'require' },
    };
    assert.ok(_bad);
  });
});
