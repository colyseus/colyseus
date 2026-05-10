import type { DatabaseSyncOptions } from 'node:sqlite';
import { generateCreateTableSQL, generateAlterAddColumnSQL } from './utils.ts';
import { AuthService } from './services/AuthService.ts';
import { ConfigService } from './services/ConfigService.ts';
import { CloudSaveService } from './services/CloudSaveService.ts';
import { LeaderboardsService } from './services/LeaderboardsService.ts';
import { ItemsService } from './services/ItemsService.ts';
import { TimedEventsService } from './services/TimedEventsService.ts';
import { AnalyticsService } from './services/AnalyticsService.ts';
import { ModerationService } from './services/ModerationService.ts';
import { NotesService } from './services/NotesService.ts';
import { AuditService } from './services/AuditService.ts';
import { AddressBansService } from './services/AddressBansService.ts';
import { SegmentsService } from './services/SegmentsService.ts';
import { buildRelationsCallback, mergeRelations, type RelationDefinition } from './relations-meta.ts';
import type { SchemaSet } from './types.ts';
import { topologicalSort, type TableEntry } from './schemas/registry.ts';
import type { SegmentDefinition, DrizzleFor } from './segments.ts';

/**
 * Resolve schema slot K to the user's table type if provided, else fall back
 * to the loose constraint shape. Drives the GameDatabase generic so e.g.
 * `db.auth.findByEmail()` returns the user's full row including custom
 * columns when they passed a customized `users` table.
 */
type Resolve<S extends Partial<SchemaSet>, K extends keyof SchemaSet> =
  S extends { [P in K]: infer T } ? T : SchemaSet[K];

/**
 * postgres-js Options surface (curated subset). The full type comes from the
 * `postgres` package which is an optional peer; we inline the well-known
 * tuning fields so users can autocomplete + type-check the common production
 * settings without forcing a `postgres` install on sqlite-only consumers.
 *
 * Strict — no index signature, so dialect-mismatched fields (e.g. PGlite's
 * `relaxedDurability`) trip the compiler. For obscure postgres-js options,
 * cast at the call site: `connection: { weirdOpt: 1 } as any`.
 */
export interface PostgresJsConnectionOptions {
  /** Connection pool size (postgres-js default: 10). */
  max?: number;
  /** TLS posture. `'require'` is the safe production default. */
  ssl?: 'require' | 'allow' | 'prefer' | 'verify-full' | boolean | object;
  /** Close idle connections after N seconds. */
  idle_timeout?: number;
  /** Error if a connection can't be established within N seconds. */
  connect_timeout?: number;
  /** `false` disables prepared-statement caching (use over PgBouncer). */
  prepare?: boolean;
  /** Maximum lifetime for a single connection in seconds. */
  max_lifetime?: number;
  /** Session GUCs sent at connect time (statement_timeout, etc.). */
  connection?: {
    statement_timeout?: number;
    idle_in_transaction_session_timeout?: number;
    application_name?: string;
    [k: string]: string | number | undefined;
  };
  /** Custom column/value transformers (see postgres-js docs). */
  transform?: any;
  /** Custom type parsers (see postgres-js docs). */
  types?: Record<string, any>;
  onnotice?: (notice: any) => void;
  onparameter?: (key: string, value: any) => void;
  debug?: boolean | ((...args: any[]) => void);
  fetch_types?: boolean;
}

/**
 * @electric-sql/pglite options (curated subset). `dataDir` falls back to
 * whatever the `pglite://...` connection string specifies; explicit value
 * here wins. Strict — no index signature.
 */
export interface PgliteConnectionOptions {
  dataDir?: string;
  /** Trade durability for throughput — skip fsync on commit. */
  relaxedDurability?: boolean;
  extensions?: Record<string, any>;
  username?: string;
  password?: string;
  loadDataDir?: any;
  fs?: any;
}

/** Public dialect tag — surfaces in option type to let TS pick the right `connection` shape. */
export type Dialect = 'sqlite' | 'pg' | 'pglite';

/** Fields shared across every dialect. */
interface CommonOptions<S extends Partial<SchemaSet> = {}> {
  /**
   * Connection string. When `dialect` isn't set, the prefix decides:
   *   - "postgres://..." or "postgresql://..." → PostgreSQL
   *   - "pglite://path-or-:memory:"            → embedded PGlite
   *   - anything else (or unset)               → SQLite file path
   *
   * SQLite default file: "colyseus.db".
   */
  connectionString?: string;

  /**
   * Provide an existing Drizzle database instance. When set, connectionString
   * is ignored and no connection is managed (must pair with `dialect`).
   */
  db?: any;

  /**
   * Migration strategy:
   *  - `"auto"` (default): CREATE TABLE IF NOT EXISTS + ALTER ADD COLUMN.
   *  - `{ files: "./drizzle" }`: drizzle-orm's file-based migrator.
   *  - `"skip"`: caller manages the schema externally.
   */
  migrations?: 'auto' | 'skip' | { files: string };

  /**
   * Custom table schemas. Spread base columns + extend:
   *
   *   import { tables } from '@colyseus/database';
   *   const users = tables.sqlite.users('users', {
   *     displayName: text('display_name'),
   *   });
   *   const db = new GameDatabase({ schemas: { users } });
   *   await db.boot();
   *   db.auth.settings.onFindUserByEmail!('a@b').then((u) => u?.displayName);
   *   //                                                       ^ inferred — flows from `users`
   *
   * The generic `S` is inferred from this field: services on the resulting
   * GameDatabase get types specialized to whatever tables you passed.
   * Slots not provided fall back to the loose `SchemaSet[K]` shape.
   */
  schemas?: S;

  /**
   * Player segments — declarative cohorts used by live-ops features
   * (mailbox, A/B experiments, targeted configs). Define with
   * `defineSegment(id, { resolve })`; resolution runs at call time
   * against the live DB.
   */
  segments?: SegmentDefinition[];

  /**
   * Foreign-key relations between tables, keyed by source table name. The
   * admin engine reads this metadata to surface related rows on resource
   * detail pages (tabs / badges) and to back the `/admin-api/:resource/:id/
   * relations/:name` endpoint.
   *
   * Built-ins between the package's own tables (users ↔ cloudSaves /
   * playerItems / leaderboardEntries / etc.) are auto-included. Use this
   * field to declare relations involving custom tables.
   *
   * @example
   *   relations: {
   *     users: [
   *       { name: 'guilds', target: 'guildMembers', kind: 'many', fk: 'userId' },
   *     ],
   *     guildMembers: [
   *       { name: 'user', target: 'users', kind: 'one', fk: 'userId' },
   *     ],
   *   }
   */
  relations?: Record<string, RelationDefinition[]>;
}

/**
 * SQLite-specific options. `dialect` is optional here and defaults the
 * narrowing — `new GameDatabase({})` and
 * `new GameDatabase({ connection: { readOnly: true } })` both get sqlite typing.
 *
 *   connection: Node's DatabaseSyncOptions
 *               → readOnly, enableForeignKeyConstraints, allowExtension, ...
 *   pragmas:    PRAGMA overrides (WAL + foreign_keys=ON applied by default)
 *               → { synchronous: 'NORMAL', cache_size: -64000, ... } | false
 */
export interface SqliteDatabaseOptions<S extends Partial<SchemaSet> = {}> extends CommonOptions<S> {
  dialect?: 'sqlite';
  connection?: DatabaseSyncOptions;
  /** SQLite-only PRAGMAs applied after open. `false` skips all defaults. */
  pragmas?: Record<string, string | number> | false;
}

/**
 * PostgreSQL options (real Postgres via postgres-js).
 *
 *   connection: PostgresJsConnectionOptions
 *               → max, ssl, idle_timeout, prepare, connection.statement_timeout, ...
 */
export interface PostgresDatabaseOptions<S extends Partial<SchemaSet> = {}> extends CommonOptions<S> {
  dialect: 'pg';
  connection?: PostgresJsConnectionOptions;
  /** PRAGMAs are SQLite-only — pg has session GUCs in connection.connection.* */
  pragmas?: never;
}

/**
 * PGlite options (embedded Wasm Postgres).
 *
 *   connection: PgliteConnectionOptions
 *               → relaxedDurability, extensions, dataDir, ...
 */
export interface PgliteDatabaseOptions<S extends Partial<SchemaSet> = {}> extends CommonOptions<S> {
  dialect: 'pglite';
  connection?: PgliteConnectionOptions;
  pragmas?: never;
}

/**
 * Discriminated by `dialect`. Misuse is a type error:
 *
 *   new GameDatabase({ dialect: 'sqlite', connection: { max: 20 } });
 *   //                                                  ~~~ not in DatabaseSyncOptions
 *
 *   new GameDatabase({ dialect: 'pg', pragmas: { foreign_keys: 'ON' } });
 *   //                                ~~~~~~~ Type 'object' is not assignable to 'never'
 *
 * Without explicit `dialect`, the union narrows to sqlite (the default). For
 * env-var-driven runtime configs where the literal type is just `string`,
 * set `dialect` explicitly to get the right `connection` typing.
 */
export type GameDatabaseOptions<S extends Partial<SchemaSet> = {}> =
  | SqliteDatabaseOptions<S>
  | PostgresDatabaseOptions<S>
  | PgliteDatabaseOptions<S>;

/**
 * SQL flavor — controls dialect-specific query construction (e.g. GREATEST
 * vs max() in LeaderboardsService). pg-flavored is shared by both real
 * Postgres and PGlite; only the driver differs.
 */
type SQLFlavor = 'sqlite' | 'pg';

/**
 * Internal sub-dialect: pg-flavored connections come in two flavors with
 * different driver APIs:
 *   - `postgres-js`: real Postgres over network. `client(sql, ...)` template
 *     tag for queries, `client.unsafe(sql)` for raw DDL.
 *   - `pglite`: embedded WebAssembly Postgres (@electric-sql/pglite). Same
 *     SQL surface but a different driver: `client.query(sql, params)` and
 *     `client.exec(sql)`. Used for tests + dev convenience.
 *
 * SQLite is its own thing.
 */
type SubDialect = 'sqlite' | 'postgres-js' | 'pglite';

/**
 * The fully-resolved tables map exposed on `db.tables`. Drives the type
 * argument for `db.defineSegment(...)` so resolvers see the user's actual
 * schema (custom + default) without re-importing it.
 */
type ResolvedTables<S extends Partial<SchemaSet>> = { [K in keyof SchemaSet]: Resolve<S, K> };

export class GameDatabase<
  S extends Partial<SchemaSet> = {},
  Dialect extends 'sqlite' | 'pg' = 'sqlite',
> {
  auth: AuthService<Resolve<S, 'users'>>;
  config: ConfigService<Resolve<S, 'configs'>>;
  saves: CloudSaveService<Resolve<S, 'cloudSaves'>>;
  leaderboards: LeaderboardsService<Resolve<S, 'leaderboards'>, Resolve<S, 'leaderboardEntries'>>;
  items: ItemsService<Resolve<S, 'items'>, Resolve<S, 'playerItems'>>;
  events: TimedEventsService<Resolve<S, 'timedEvents'>>;
  analytics: AnalyticsService<Resolve<S, 'analyticsEvents'>>;
  moderation: ModerationService<Resolve<S, 'userRoles'>, Resolve<S, 'modAssignments'>>;
  notes: NotesService<Resolve<S, 'userNotes'>>;
  audit: AuditService<Resolve<S, 'adminAudit'>>;
  addressBans: AddressBansService<Resolve<S, 'bannedAddresses'>>;
  /**
   * Player segments. Available before boot — `db.segments.define(...)` is
   * typed via this database's schema + dialect generics. Reads (`size`,
   * `ids`, `has`, `forEach`) require boot to have run.
   */
  segments: SegmentsService<ResolvedTables<S>, Dialect> = new SegmentsService();

  /**
   * Map of resolved drizzle tables, keyed by their canonical name
   * (e.g. "users", "configs", "leaderboards" — not the colyseus_-prefixed
   * physical table name). Available after boot(). Pass into the admin
   * panel — and any other tooling that needs to introspect schemas —
   * via `tables: { ...database.tables, ...customTables }`.
   */
  tables: { [K in keyof SchemaSet]: Resolve<S, K> };

  /**
   * The underlying Drizzle database instance (available after boot). Typed
   * against this database's resolved schema + dialect, so:
   *
   *   db.drizzle.select(...).from(db.tables.users)        // row shape inferred
   *
   * For dialect-specific extension methods (e.g. postgres-js's `unsafe`),
   * narrow with a type guard or cast at the call site.
   */
  drizzle: DrizzleFor<ResolvedTables<S>, Dialect>;

  /**
   * Foreign-key relations between tables, keyed by source table name. The
   * admin reads this for relationship-aware detail pages. Built-ins +
   * `options.relations` merged at boot time.
   */
  relations: Record<string, RelationDefinition[]> = mergeRelations(undefined);

  /**
   * SQL flavor — `'sqlite'` or `'pg'`. PGlite collapses to `'pg'` here
   * (same SQL surface; only the driver differs). Public + readonly so
   * downstream code (admin panel, custom services, anything reading
   * `db.dialect`) can branch on this without `any`-casting.
   */
  readonly dialect: SQLFlavor;
  private subDialect: SubDialect = 'sqlite';
  private options: GameDatabaseOptions<S>;
  private ownedConnection: any = null;

  constructor(options: GameDatabaseOptions<S> = {} as GameDatabaseOptions<S>) {
    this.options = options;
    this.relations = mergeRelations(options.relations);

    // Detect SQL flavor (sqlite | pg). The 'pglite' public dialect maps to
    // 'pg' here — PGlite is just a different driver for the same SQL surface.
    // The discriminator narrows `options` to `never` once every dialect literal
    // has been eliminated; access shared CommonOptions fields via a CommonOptions
    // view rather than the dispatched union.
    const common = options as CommonOptions<S>;
    if (options.dialect === 'pg' || options.dialect === 'pglite') {
      this.dialect = 'pg';
    } else if (options.dialect === 'sqlite') {
      this.dialect = 'sqlite';
    } else if (common.db) {
      // When user provides db without dialect hint, default to sqlite
      this.dialect = 'sqlite';
    } else {
      this.dialect = detectDialect(common.connectionString);
    }
  }

  async boot() {
    // 1. Resolve schemas first — drizzle needs them at construction time so
    //    `db.query.<table>` is wired up (sqlite consumes `schema:` directly;
    //    pg/pglite get the table set via auto-built `defineRelations`).
    const schemas = await this.resolveSchemas();
    this.tables = { ...schemas };

    // 2. Create or adopt Drizzle instance
    if (this.options.db) {
      this.drizzle = this.options.db;
      this.subDialect = this.dialect === 'pg' ? 'postgres-js' : 'sqlite';
    } else if (this.options.dialect === 'pglite') {
      // Explicit pglite — connectionString is the data dir (or empty/:memory:)
      const cs = this.options.connectionString ?? '';
      const dataDir = cs.startsWith('pglite://') ? cs.slice('pglite://'.length) : cs;
      await this.bootPGlite(dataDir, schemas);
    } else if (this.dialect === 'pg') {
      const cs = this.options.connectionString ?? '';
      if (cs.startsWith('pglite://')) {
        await this.bootPGlite(cs.slice('pglite://'.length), schemas);
      } else {
        await this.bootPostgres(schemas);
      }
    } else {
      await this.bootSQLite(schemas);
    }

    // 3. Apply migrations according to the configured strategy
    const strategy = this.options.migrations ?? 'auto';
    if (strategy === 'auto') {
      // Create-or-extend behavior: idempotent, dev-friendly. No DROP/type-change.
      await this.createTables(schemas);
      await this.alterTablesForNewColumns(schemas);
    } else if (strategy === 'skip') {
      // No-op: caller manages the schema externally (e.g. CI step that ran
      // `drizzle-kit migrate` before the server started).
    } else if (typeof strategy === 'object' && 'files' in strategy) {
      // File-based: run drizzle-orm's migrator from the SQL folder produced
      // by `drizzle-kit generate`. Idempotent — drizzle tracks applied
      // migrations in its own __drizzle_migrations table.
      await this.runFileMigrations(strategy.files);
    } else {
      throw new Error(`[GameDatabase] unknown migration strategy: ${JSON.stringify(strategy)}`);
    }

    // 4. Instantiate services
    this.auth = new AuthService(this.drizzle, schemas.users);
    this.config = new ConfigService(this.drizzle, schemas.configs);
    this.saves = new CloudSaveService(this.drizzle, schemas.cloudSaves);
    this.leaderboards = new LeaderboardsService(
      this.drizzle,
      schemas.leaderboards,
      schemas.leaderboardEntries,
      this.dialect,
    );
    this.items = new ItemsService(this.drizzle, schemas.items, schemas.playerItems);
    this.events = new TimedEventsService(this.drizzle, schemas.timedEvents);
    this.analytics = new AnalyticsService(this.drizzle, schemas.analyticsEvents);
    this.moderation = new ModerationService(
      this.drizzle,
      schemas.userRoles,
      schemas.modAssignments,
    );
    this.notes = new NotesService(this.drizzle, schemas.userNotes);
    this.audit = new AuditService(this.drizzle, schemas.adminAudit);
    this.addressBans = new AddressBansService(this.drizzle, schemas.bannedAddresses);
    // The segments service was created at construction time so users could
    // call `db.segments.define(...)` pre-boot. Now that drizzle + tables
    // are live, hand them over and merge any segments passed via options.
    this.segments.__attach(
      this.drizzle,
      this.tables as Record<string, any>,
      this.options.segments ?? [],
    );
  }

  async shutdown() {
    if (this.ownedConnection) {
      if (this.subDialect === 'postgres-js') {
        await this.ownedConnection.end();
      } else if (this.subDialect === 'pglite') {
        await this.ownedConnection.close();
      } else {
        this.ownedConnection.close();
      }
      this.ownedConnection = null;
    }
  }

  // -------------------------------------------------------------------------
  // Private: dialect-specific boot
  // -------------------------------------------------------------------------

  private async bootSQLite(schemas: Record<string, any>) {
    const { drizzle } = await import('drizzle-orm/node-sqlite');
    const { defineRelations } = await import('drizzle-orm');

    const dbPath = this.options.connectionString || 'colyseus.db';

    // Forward user options to Node's DatabaseSync via drizzle's `connection`
    // passthrough. `path` is filled from connectionString if not overridden.
    // Cast: `this.options` is the wide GameDatabaseOptions union here (TS
    // can't narrow on a runtime dialect dispatch); we know we're on sqlite.
    const userOpts = (this.options.connection ?? {}) as DatabaseSyncOptions;
    // Concrete factory return (NodeSQLiteDatabase) is a subtype of the public
    // `DrizzleFor<S, Dialect>` for sqlite; a cast keeps the internal assignment
    // tidy without leaking the dialect-specific subclass to consumers.
    //
    // `schema` enables the relational query API (db.query.users.findMany());
    // `relations` is auto-built from our RelationDefinition metadata
    // (built-ins + options.relations), so `with: { saves: true }`-style
    // joins work out of the box for both dialects.
    //
    // The whole config is `as any`-cast: `schemas` is typed `Record<string,
    // any>` here, too wide for drizzle's strict relational inference, so
    // both `defineRelations(...)` and the resulting drizzle() call fail
    // overload matching. The public `database.drizzle` type still resolves
    // correctly via DrizzleFor<S, ...> which threads the user's actual
    // schema generic — that's what consumers see.
    this.drizzle = drizzle({
      connection: { path: dbPath, ...userOpts },
      schema: schemas,
      relations: defineRelations(schemas as any, buildRelationsCallback(schemas, this.relations) as any),
    } as any) as unknown as typeof this.drizzle;

    // $client is the underlying DatabaseSync — needed for raw DDL + pragmas
    this.ownedConnection = (this.drizzle as any).$client;
    this.subDialect = 'sqlite';

    this.applySqlitePragmas();
  }

  private applySqlitePragmas() {
    const userPragmas = this.options.pragmas;
    if (userPragmas === false) {
      // Caller opted out of all defaults — no WAL, no FK, no nothing.
      return;
    }
    // Defaults preserved unless the caller overrides them in `pragmas`.
    const defaults: Record<string, string | number> = {
      journal_mode: 'WAL',          // better concurrent read performance
      foreign_keys: 'ON',           // off by default in SQLite, on everywhere else
    };
    const merged = { ...defaults, ...(userPragmas ?? {}) };
    for (const [key, value] of Object.entries(merged)) {
      this.ownedConnection.exec(`PRAGMA ${key} = ${value}`);
    }
  }

  private async bootPostgres(schemas: Record<string, any>) {
    const pg = (await import('postgres')).default;
    const { drizzle } = await import('drizzle-orm/postgres-js');
    const { defineRelations } = await import('drizzle-orm');

    const connectionString = this.options.connectionString || process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/postgres';
    // postgres-js: pass the URL positionally + any tuning opts (max, ssl,
    // idle_timeout, prepare, statement_timeout, etc.) as a second arg.
    // Cast: see bootSQLite — `this.options` is the wide union here.
    const userOpts = this.options.connection as PostgresJsConnectionOptions | undefined;
    const sql = pg(connectionString, userOpts);

    // PG drivers don't accept a `schema` option (DrizzlePgConfig omits it);
    // the relational query API (db.query.X) is built entirely from the
    // `relations` arg. We auto-build the join wiring from our
    // RelationDefinition metadata so `with: { ... }` works on both dialects.
    // (See bootSQLite for the `as any` rationale.)
    this.drizzle = drizzle({
      client: sql,
      relations: defineRelations(schemas as any, buildRelationsCallback(schemas, this.relations) as any),
    } as any) as unknown as typeof this.drizzle;
    this.ownedConnection = sql;
    this.subDialect = 'postgres-js';
  }

  /**
   * Boot against an embedded @electric-sql/pglite — Postgres in a Wasm
   * sandbox, no external server. Same SQL surface as bootPostgres so the
   * `pg` dialect path covers it; only the driver-level DDL/raw-query
   * methods diverge.
   *
   * `dataDir`:
   *   ":memory:" — fully ephemeral
   *   "./path"   — file-backed, persists across boots
   */
  private async bootPGlite(dataDir: string, schemas: Record<string, any>) {
    const { PGlite } = await import('@electric-sql/pglite');
    const { drizzle } = await import('drizzle-orm/pglite');
    const { defineRelations } = await import('drizzle-orm');

    // PGliteOptions also accepts `dataDir`, so honor explicit override and
    // fall back to the value parsed from the connection string. We're in the
    // pglite path so the `connection` field is PgliteConnectionOptions.
    const userOpts = (this.options.connection ?? {}) as PgliteConnectionOptions;
    const resolvedDataDir = userOpts.dataDir ?? (
      dataDir === ':memory:' || dataDir === '' ? undefined : dataDir
    );
    const client = new PGlite({ ...userOpts, dataDir: resolvedDataDir });
    await client.waitReady;

    // See bootPostgres for why we pass `relations` (not `schema`) on pg.
    this.drizzle = drizzle({
      client,
      relations: defineRelations(schemas as any, buildRelationsCallback(schemas, this.relations) as any),
    } as any) as unknown as typeof this.drizzle;
    this.ownedConnection = client;
    this.subDialect = 'pglite';
  }

  // -------------------------------------------------------------------------
  // Private: schema resolution and table creation
  // -------------------------------------------------------------------------

  /**
   * Load the dialect-specific table registry. Cached per boot so the dynamic
   * import only runs once across resolveSchemas/createTables/alterTablesForNewColumns.
   */
  private async loadRegistry(): Promise<ReadonlyArray<TableEntry>> {
    if (this._registryCache) { return this._registryCache; }
    // Branch on dialect so each `await import(...)` returns its own concrete
    // module type — TS can't narrow `mod.PG_TABLES || mod.SQLITE_TABLES`
    // off a unioned dynamic-import return.
    if (this.dialect === 'pg') {
      this._registryCache = (await import('./schemas/pg.ts')).PG_TABLES;
    } else {
      this._registryCache = (await import('./schemas/sqlite.ts')).SQLITE_TABLES;
    }
    return this._registryCache;
  }
  private _registryCache: ReadonlyArray<TableEntry> | null = null;

  private async resolveSchemas(): Promise<{ [K in keyof SchemaSet]: Resolve<S, K> }> {
    const userSchemas = (this.options.schemas ?? {}) as Partial<SchemaSet>;
    const registry = await this.loadRegistry();
    const out = {} as { [K in keyof SchemaSet]: Resolve<S, K> };
    for (const entry of registry) {
      // User-supplied table wins over the registry default.
      (out as any)[entry.key] = userSchemas[entry.key] ?? entry.table;
    }
    return out;
  }

  /**
   * For every registered table, diff drizzle's column list against the live DB and
   * emit ALTER TABLE … ADD COLUMN for fields that don't exist yet. Picks up new
   * columns added to user-spread schemas without forcing a fresh DB.
   *
   * Drop/type changes are not handled — those are risky and out of scope.
   */
  private async alterTablesForNewColumns(
    schemas: ReturnType<GameDatabase['resolveSchemas']> extends Promise<infer S> ? S : never,
  ) {
    const getTableConfig: (table: any) => any = this.dialect === 'pg'
      ? (await import('drizzle-orm/pg-core')).getTableConfig
      : (await import('drizzle-orm/sqlite-core')).getTableConfig;

    const allTables = Object.values(schemas);
    for (const table of allTables) {
      const config = getTableConfig(table);
      const existing = await this.fetchExistingColumns(config.name);
      if (existing.size === 0) { continue; } // table doesn't exist yet (createTables would have made it)
      const stmts = generateAlterAddColumnSQL(config, existing);
      for (const stmt of stmts) {
        await this.execRaw(stmt);
      }
    }
  }

  /**
   * Run a single raw DDL/DML statement. Routes to the right driver method:
   *   postgres-js: client.unsafe(sql)
   *   pglite:      client.exec(sql)
   *   sqlite:      client.exec(sql)
   */
  private async execRaw(stmt: string): Promise<void> {
    if (this.subDialect === 'postgres-js') {
      await this.ownedConnection.unsafe(stmt);
    } else if (this.subDialect === 'pglite') {
      await this.ownedConnection.exec(stmt);
    } else {
      this.ownedConnection.exec(stmt);
    }
  }

  /**
   * Run SQL migration files produced by `drizzle-kit generate`. Drizzle
   * tracks applied migrations in `__drizzle_migrations`, so reruns are
   * idempotent.
   */
  private async runFileMigrations(folder: string) {
    // Each dialect's migrator wants its own concrete db class; the public
    // `db.drizzle` type is the conditional union, so cast through `any` at
    // each branch. Pre-narrowed at runtime by `subDialect`.
    const drizzleClient = this.drizzle as any;
    if (this.subDialect === 'postgres-js') {
      const { migrate } = await import('drizzle-orm/postgres-js/migrator');
      await migrate(drizzleClient, { migrationsFolder: folder });
    } else if (this.subDialect === 'pglite') {
      const { migrate } = await import('drizzle-orm/pglite/migrator');
      await migrate(drizzleClient, { migrationsFolder: folder });
    } else {
      const { migrate } = await import('drizzle-orm/node-sqlite/migrator');
      await migrate(drizzleClient, { migrationsFolder: folder });
    }
  }

  private async fetchExistingColumns(tableName: string): Promise<Set<string>> {
    if (this.subDialect === 'postgres-js') {
      const rows = await this.ownedConnection`
        SELECT column_name AS name
        FROM information_schema.columns
        WHERE table_name = ${tableName}
      `;
      return new Set(rows.map((r: { name: string }) => r.name));
    }
    if (this.subDialect === 'pglite') {
      const result = await this.ownedConnection.query(
        `SELECT column_name AS name
         FROM information_schema.columns
         WHERE table_name = $1`,
        [tableName],
      );
      return new Set((result.rows as Array<{ name: string }>).map((r) => r.name));
    }
    // sqlite — pragma_table_info on a missing table returns no rows (no error)
    const rows = this.ownedConnection.prepare(`SELECT name FROM pragma_table_info(?)`).all(tableName);
    return new Set((rows as Array<{ name: string }>).map((r) => r.name));
  }

  private async createTables(schemas: ReturnType<GameDatabase['resolveSchemas']> extends Promise<infer S> ? S : never) {
    const getTableConfig: (table: any) => any = this.dialect === 'pg'
      ? (await import('drizzle-orm/pg-core')).getTableConfig
      : (await import('drizzle-orm/sqlite-core')).getTableConfig;

    // dependsOn drives the order: each table is preceded by anything it
    // references via FK. Currently no schemas declare FKs (custom user-table
    // names break drizzle's `.references()` relinking), but the ordering is
    // preserved as documentation of the dependency graph and so we're ready
    // when FKs land.
    const registry = await this.loadRegistry();
    const ordered = topologicalSort(registry);

    for (const entry of ordered) {
      // Use the resolved table (which may be the user's override) for SQL
      // generation — the registry's `entry.table` is only the default.
      const table = (schemas as any)[entry.key];
      const config = getTableConfig(table);
      const sql = generateCreateTableSQL(config);

      if (this.dialect === 'pg') {
        try {
          await this.execRaw(sql);
        } catch (error: any) {
          // Ignore "already exists" errors for concurrent boot
          if (error?.code !== '42P07' && error?.code !== '42710') {
            throw error;
          }
        }
      } else {
        // SQLite uses CREATE TABLE IF NOT EXISTS; no try/catch needed
        this.ownedConnection.exec(sql);
      }
    }
  }
}

function detectDialect(connectionString?: string): SQLFlavor {
  if (!connectionString) { return 'sqlite'; }
  if (
    connectionString.startsWith('postgres://') ||
    connectionString.startsWith('postgresql://') ||
    connectionString.startsWith('pglite://')
  ) { return 'pg'; }
  return 'sqlite';
}
