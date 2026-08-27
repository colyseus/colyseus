/**
 * `@colyseus/database/driver` — a Colyseus `MatchMakerDriver` backed by the
 * same `GameDatabase` connection you already use for auth / cloud-saves /
 * configs. One pool, one dialect, no second connection.
 *
 * It is **driver-owned**: the `colyseus_room_caches` table is created on
 * the shared connection at boot() (CREATE TABLE IF NOT EXISTS) rather than
 * registered in the GameDatabase schema registry, so deployments that use
 * `@colyseus/database` for auth but a different matchmaking medium (Redis /
 * Local) never get an unused table.
 *
 *   import { Server } from '@colyseus/core';
 *   import { GameDatabase } from '@colyseus/database';
 *   import { DatabaseDriver } from '@colyseus/database/driver';
 *
 *   new GameDatabase({ dialect: 'pg', connectionString: process.env.DATABASE_URL });
 *   new Server({ driver: new DatabaseDriver() }); // adopts GameDatabase.current
 *
 * Or bring your own drizzle instance — no GameDatabase needed:
 *
 *   new Server({ driver: new DatabaseDriver({ drizzle: db, dialect: 'sqlite' }) });
 *
 * Works on every dialect drizzle supports (pg / pglite / sqlite); the only
 * SQL that differs by dialect (JSON metadata access, integer casts, DROP)
 * is isolated behind the `flavor` seam below.
 */
import { eq, and, asc, desc, inArray, sql, type SQL } from 'drizzle-orm';
import {
  type IRoomCache,
  type MatchMakerDriver,
  type Room,
  type SortOptions,
  type RegisteredHandler,
  debugMatchMaking,
  matchMaker,
} from '@colyseus/core';

import { GameDatabase } from './GameDatabase.ts';
import { generateCreateTableSQL, generateCreateIndexSQL } from './utils.ts';
import { colyseusRoomCaches as pgRoomCaches } from './schemas/pg.ts';
import { colyseusRoomCaches as sqliteRoomCaches } from './schemas/sqlite.ts';
// Re-exported so consumers of the driver subpath can reference the
// sentinel too; canonical definition lives in ./constants.ts.
import { POSTGRES_MAX_INTEGER } from './constants.ts';
export { POSTGRES_MAX_INTEGER } from './constants.ts';

/** Any drizzle table whose column keys mirror `IRoomCache`. */
type RoomCacheTable = any;

/**
 * The handful of SQL fragments that differ between Postgres-flavored
 * (pg / pglite) and SQLite connections. Everything else in this driver is
 * plain drizzle query-builder and is dialect-portable as-is.
 */
interface SqlFlavor {
  /** `metadata.<key> = value` predicate over the JSON metadata column. */
  jsonEq(metadataCol: any, key: string, value: any): SQL;
  /** ORDER BY fragments: numeric-aware sort then text fallback. */
  jsonOrder(metadataCol: any, key: string, descending: boolean): SQL[];
  /** Wrap a JS number so the DB treats it as an integer in arithmetic. */
  intCast(value: number): SQL;
  /** Drop the room-cache table (used by clear() in tests). */
  dropTableSQL(tableName: string): string;
}

const pgFlavor: SqlFlavor = {
  jsonEq: (m, k, v) => sql`${m}->>${k} = ${v}`,
  jsonOrder: (m, k, descending) => {
    const numeric = sql`CASE WHEN jsonb_typeof(${m}->${k}) = 'number' THEN (${m}->>${k})::numeric END`;
    const text = sql`${m}->>${k}`;
    return descending ? [desc(numeric), desc(text)] : [asc(numeric), asc(text)];
  },
  intCast: (v) => sql`${v}::integer`,
  dropTableSQL: (t) => `DROP TABLE IF EXISTS "${t}" CASCADE`,
};

const sqliteFlavor: SqlFlavor = {
  jsonEq: (m, k, v) => sql`json_extract(${m}, ${'$.' + k}) = ${v}`,
  jsonOrder: (m, k, descending) => {
    const path = '$.' + k;
    const numeric = sql`CASE WHEN json_type(${m}, ${path}) IN ('integer','real') THEN CAST(json_extract(${m}, ${path}) AS REAL) END`;
    const text = sql`json_extract(${m}, ${path})`;
    return descending ? [desc(numeric), desc(text)] : [asc(numeric), asc(text)];
  },
  intCast: (v) => sql`CAST(${v} AS INTEGER)`,
  dropTableSQL: (t) => `DROP TABLE IF EXISTS "${t}"`,
};

/**
 * Bind to an existing `GameDatabase` (defaults to `GameDatabase.current`).
 * One pool shared with auth / cloud-saves / configs; GameDatabase owns the
 * connection lifecycle, so `shutdown()` here is a no-op.
 */
export interface DatabaseDriverGameDatabaseOptions {
  database?: GameDatabase<any, any, any>;
  /**
   * Custom room-cache table. Build it with the `columns.{pg,sqlite}
   * .roomCaches` spread or the `tables.{pg,sqlite}.roomCaches(name,
   * extras)` factory from `@colyseus/database`. A different physical
   * name and extra columns are both fine; defaults to the built-in
   * `colyseus_room_caches` for the database's dialect.
   */
  schema?: RoomCacheTable;
}

/**
 * Bind to your own drizzle instance — no GameDatabase required. Works for
 * any dialect drizzle supports (`'pg'` covers postgres-js + pglite). The
 * driver still creates/owns its `colyseus_room_caches` table via the
 * instance's `$client`.
 *
 *   import { drizzle } from 'drizzle-orm/node-sqlite';
 *   const db = drizzle({ connection: { path: 'game.db' } });
 *   new Server({ driver: new DatabaseDriver({ drizzle: db, dialect: 'sqlite' }) });
 */
export interface DatabaseDriverDrizzleOptions {
  /** A drizzle instance (postgres-js / pglite / node-sqlite). */
  drizzle: any;
  /** SQL flavor of the instance. `'pg'` for postgres-js and pglite. */
  dialect: 'pg' | 'sqlite';
  /** See {@link DatabaseDriverGameDatabaseOptions.schema}. */
  schema?: RoomCacheTable;
  /**
   * Close the connection on `shutdown()`. Defaults to `true`: in raw mode
   * there's no GameDatabase to tear it down, so the driver does it (the
   * Colyseus server calls `driver.shutdown()` on stop). Set `false` if you
   * reuse this drizzle instance elsewhere and manage its lifecycle yourself.
   */
  closeOnShutdown?: boolean;
}

export type DatabaseDriverOptions =
  | DatabaseDriverGameDatabaseOptions
  | DatabaseDriverDrizzleOptions;

export class DatabaseDriver implements MatchMakerDriver {
  private database?: GameDatabase<any, any, any>;
  private dialect: 'pg' | 'sqlite';
  private schema: RoomCacheTable;
  private db: any;
  private flavor: SqlFlavor;
  // Raw-mode (user-owned drizzle) vs. GameDatabase-bound.
  private rawMode = false;
  // Raw mode only: close the connection on shutdown().
  private closeOnShutdown = false;
  // Resolved at boot() — drives raw DDL (CREATE/DROP) on the shared client.
  private rawClient: any = null;

  constructor(options?: DatabaseDriverOptions) {
    const raw = options && 'drizzle' in options ? options : undefined;

    if (raw) {
      this.rawMode = true;
      this.db = raw.drizzle;
      this.dialect = raw.dialect;
      this.closeOnShutdown = raw.closeOnShutdown ?? true;
    } else {
      const gdbOpts = options as DatabaseDriverGameDatabaseOptions | undefined;
      const database = gdbOpts?.database ?? GameDatabase.current;
      if (!database) {
        throw new Error(
          '[DatabaseDriver] no GameDatabase available — construct `new GameDatabase(...)` before `new DatabaseDriver()`, pass `database:` explicitly, or use raw mode `{ drizzle, dialect }`',
        );
      }
      this.database = database;
      // `dialect` is the public SQL flavor ('pg' covers pglite too).
      this.dialect = database.dialect;
    }

    this.flavor = this.dialect === 'pg' ? pgFlavor : sqliteFlavor;
    this.schema = options?.schema
      ?? (this.dialect === 'pg' ? pgRoomCaches : sqliteRoomCaches);
  }

  public async boot() {
    if (this.database) {
      // GameDatabase.boot() is idempotent — safe regardless of whether
      // Server.listen() already triggered it.
      await this.database.boot();
      this.db = this.database.drizzle;
    }
    this.rawClient = (this.db as any)?.$client ?? null;

    const tableName = await this.tableName();
    try {
      await this.ensureTable();
      debugMatchMaking(`DatabaseDriver: ensured ${tableName} table`);
    } catch (error: any) {
      // Concurrent boot across processes: ignore pg "already exists"
      // (42P07) / duplicate-object (42710). sqlite/pglite use IF NOT
      // EXISTS so they don't throw here.
      if (error?.code === '42P07' || error?.code === '42710') {
        debugMatchMaking(`DatabaseDriver: ${tableName} table already exists`);
      } else {
        debugMatchMaking(`DatabaseDriver: error creating ${tableName} table:`, error);
        throw error;
      }
    }
  }

  public async has(roomId: string) {
    const result = await this.db
      .select()
      .from(this.schema)
      .where(eq(this.schema.roomId, roomId))
      .limit(1);
    return result.length > 0;
  }

  public async query<T extends Room = any>(
    conditions: Partial<IRoomCache & matchMaker.ExtractRoomCacheMetadata<T>>,
    sortOptions?: SortOptions,
  ): Promise<Array<IRoomCache<matchMaker.ExtractRoomCacheMetadata<T>>>> {
    return await this.getRooms<T>(conditions, sortOptions);
  }

  public async cleanup(processId: string) {
    const removed = await this.db
      .delete(this.schema)
      .where(eq(this.schema.processId, processId))
      .returning({ roomId: this.schema.roomId });
    debugMatchMaking(`DatabaseDriver: removing stale rooms by processId ${processId} (${removed.length} rooms found)`);
  }

  public async findOne<T extends Room = any>(
    conditions: Partial<IRoomCache & matchMaker.ExtractRoomCacheMetadata<T>>,
    sortOptions?: SortOptions,
  ) {
    if (typeof conditions.roomId !== 'undefined') {
      return (await this.db
        .select()
        .from(this.schema)
        .where(eq(this.schema.roomId, conditions.roomId))
        .limit(1))[0] as IRoomCache<matchMaker.ExtractRoomCacheMetadata<T>>;
    }
    return (await this.getRooms<T>(conditions, sortOptions, 1))[0];
  }

  public async findByIds(roomIds: string[]): Promise<Map<string, IRoomCache>> {
    const result = new Map<string, IRoomCache>();
    if (roomIds.length === 0) { return result; }
    const rows = await this.db
      .select()
      .from(this.schema)
      .where(inArray(this.schema.roomId, roomIds));
    for (const row of rows as any[]) { result.set(row.roomId, row as IRoomCache); }
    return result;
  }

  private getRooms<T extends Room = any>(
    conditions: Partial<IRoomCache & matchMaker.ExtractRoomCacheMetadata<T>>,
    sortOptions?: SortOptions,
    limit?: number,
  ): Promise<Array<IRoomCache<matchMaker.ExtractRoomCacheMetadata<T>>>> {
    const registeredHandler = matchMaker.getAllHandlers()[conditions.name];

    let query = this.db
      .select()
      .from(this.schema)
      .where(and(...this.buildWhereClause(registeredHandler, conditions)))
      .$dynamic();

    const orderBy = this.buildOrderBy(registeredHandler, sortOptions);
    if (orderBy.length > 0) { query = query.orderBy(...orderBy); }
    if (limit !== undefined) { query = query.limit(limit); }

    return query.then((result: any[]) =>
      result.map((room) => room as IRoomCache<matchMaker.ExtractRoomCacheMetadata<T>>));
  }

  public async update(
    room: IRoomCache,
    operations: Partial<{ $set: Partial<IRoomCache>, $inc: Partial<IRoomCache> }>,
  ) {
    const setFields: any = {};
    let clientsIncrement: number | undefined;

    if (operations.$set) {
      for (const field in operations.$set) {
        if (operations.$set.hasOwnProperty(field) && operations.$set[field] !== undefined) {
          setFields[field] = operations.$set[field];
        }
      }
    }

    if (operations.$inc) {
      for (const field in operations.$inc) {
        if (operations.$inc.hasOwnProperty(field)) {
          const value = operations.$inc[field];
          if (value !== undefined) {
            setFields[field] = (value >= 0)
              ? sql`${this.schema[field]} + ${this.flavor.intCast(value)}`
              : sql`${this.schema[field]} - ${this.flavor.intCast(Math.abs(value))}`;
            if (field === 'clients') { clientsIncrement = value; }
          }
        }
      }
    }

    if (Object.keys(setFields).length === 0) {
      return true;
    }

    //
    // When incrementing clients AND setting locked, compute locked
    // atomically from the new clients value so concurrent reservations
    // can't overwrite each other's lock decision. Preserve an explicit
    // lock via OR. (Only the integer cast differs by dialect.)
    //
    if (clientsIncrement !== undefined && clientsIncrement > 0 && setFields.locked !== undefined) {
      setFields.locked = sql`${this.schema.locked} OR ((${this.schema.clients} + ${this.flavor.intCast(clientsIncrement)}) >= ${this.schema.maxClients})`;
    }

    await this.db
      .update(this.schema)
      .set(setFields)
      .where(eq(this.schema.roomId, room.roomId));

    return true;
  }

  public async persist(room: IRoomCache, create: boolean = false) {
    if (create) {
      await this.db.insert(this.schema).values(this.sanitizeRoomData(room));
    } else {
      const updateFields: any = this.sanitizeRoomData(room);
      delete updateFields.roomId; // never update the primary key
      await this.update(room, { $set: updateFields });
    }
    return true;
  }

  public async remove(roomId: string) {
    const removed = await this.db
      .delete(this.schema)
      .where(eq(this.schema.roomId, roomId))
      .returning({ roomId: this.schema.roomId });
    return removed.length > 0;
  }

  public async shutdown() {
    // GameDatabase mode: the pool is owned by GameDatabase —
    // GameDatabase.shutdown() tears it down, never here.
    if (!this.rawMode || !this.closeOnShutdown) { return; }

    const client = this.rawClient;
    if (!client) { return; }
    // postgres-js: `.end()`. pglite / node:sqlite: `.close()`
    // (node:sqlite's is sync — awaiting `undefined` is harmless).
    if (typeof client.end === 'function') {
      await client.end();
    } else if (typeof client.close === 'function') {
      await client.close();
    }
    this.rawClient = null;
  }

  public async clear() {
    if (!this.rawClient) { return; }
    const tableName = await this.tableName();
    await this.execRaw(this.flavor.dropTableSQL(tableName));
    await this.ensureTable();
  }

  // -------------------------------------------------------------------------
  // Internal helpers
  // -------------------------------------------------------------------------

  // Filter undefined values, route non-schema fields into `metadata`, and
  // cap maxClients (Infinity) to a DB-safe integer.
  private sanitizeRoomData(room: Partial<IRoomCache>): IRoomCache {
    const sanitized: any = {};
    const metadata: Record<string, any> = {};

    for (const fieldName in room) {
      if (room.hasOwnProperty(fieldName)) {
        const value = (room as any)[fieldName];
        if (value !== undefined) {
          if (this.schema[fieldName] !== undefined) {
            sanitized[fieldName] = value;
          } else {
            metadata[fieldName] = value;
          }
        }
      }
    }

    if (Object.keys(metadata).length > 0) {
      sanitized.metadata = { ...(sanitized.metadata || {}), ...metadata };
    }

    if (sanitized.maxClients > POSTGRES_MAX_INTEGER) {
      sanitized.maxClients = POSTGRES_MAX_INTEGER;
    }

    return sanitized;
  }

  private buildWhereClause(
    _registeredHandler: RegisteredHandler | undefined,
    conditions: Partial<IRoomCache>,
  ): SQL[] {
    return Object.entries(conditions)
      .filter(([_, value]) => value !== undefined)
      .map(([fieldName, value]) =>
        this.schema[fieldName] === undefined
          ? this.flavor.jsonEq(this.schema.metadata, fieldName, value)
          : eq(this.schema[fieldName], value));
  }

  private buildOrderBy(
    _registeredHandler: RegisteredHandler | undefined,
    sortOptions?: SortOptions,
  ): SQL[] {
    const clauses: SQL[] = [];
    for (const [fieldName, direction] of Object.entries(sortOptions ?? {})) {
      const descending = (direction === -1 || direction === 'desc' || direction === 'descending');
      if (this.schema[fieldName] === undefined) {
        clauses.push(...this.flavor.jsonOrder(this.schema.metadata, fieldName, descending));
      } else {
        clauses.push(descending ? desc(this.schema[fieldName]) : asc(this.schema[fieldName]));
      }
    }
    return clauses;
  }

  // CREATE TABLE + its indexes, all IF NOT EXISTS.
  private async ensureTable(): Promise<void> {
    const config = await this.tableConfig();
    await this.execRaw(generateCreateTableSQL(config, this.dialect));
    for (const stmt of generateCreateIndexSQL(config, this.dialect)) {
      await this.execRaw(stmt);
    }
  }

  private async getTableConfig(): Promise<(table: any) => any> {
    return this.dialect === 'pg'
      ? (await import('drizzle-orm/pg-core')).getTableConfig
      : (await import('drizzle-orm/sqlite-core')).getTableConfig as any;
  }

  private async tableConfig() {
    return (await this.getTableConfig())(this.schema);
  }

  private async tableName(): Promise<string> {
    return (await this.tableConfig()).name;
  }

  // Raw DDL on the shared client. postgres-js exposes `.unsafe()`;
  // pglite and node:sqlite both expose `.exec()` (pglite async,
  // node:sqlite sync — awaiting a sync `undefined` is harmless).
  private async execRaw(ddl: string): Promise<void> {
    const client = this.rawClient;
    if (!client) {
      throw new Error('[DatabaseDriver] no raw client available for DDL — GameDatabase not booted?');
    }
    if (typeof client.unsafe === 'function') {
      await client.unsafe(ddl);
    } else if (typeof client.exec === 'function') {
      await client.exec(ddl);
    } else {
      throw new Error('[DatabaseDriver] shared connection exposes no raw DDL method (.unsafe/.exec)');
    }
  }
}
