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
import { SegmentsService } from './services/SegmentsService.ts';
import type { SchemaSet } from './types.ts';
import type { SegmentDefinition, SegmentResolveContext } from './segments.ts';

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
  segments: SegmentsService;

  /**
   * Map of resolved drizzle tables, keyed by their canonical name
   * (e.g. "users", "configs", "leaderboards" — not the colyseus_-prefixed
   * physical table name). Available after boot(). Pass into the admin
   * panel — and any other tooling that needs to introspect schemas —
   * via `tables: { ...database.tables, ...customTables }`.
   */
  tables: { [K in keyof SchemaSet]: Resolve<S, K> };

  /** The underlying Drizzle database instance (available after boot). */
  drizzle: any;

  private dialect: SQLFlavor;
  private subDialect: SubDialect = 'sqlite';
  private options: GameDatabaseOptions<S>;
  private ownedConnection: any = null;
  /** Segments registered via `db.defineSegment(...)` before boot. Merged with
   *  `options.segments` when SegmentsService is instantiated at boot time. */
  private inlineSegments: SegmentDefinition[] = [];

  constructor(options: GameDatabaseOptions<S> = {} as GameDatabaseOptions<S>) {
    this.options = options;

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
    // 1. Create or adopt Drizzle instance
    if (this.options.db) {
      this.drizzle = this.options.db;
      this.subDialect = this.dialect === 'pg' ? 'postgres-js' : 'sqlite';
    } else if (this.options.dialect === 'pglite') {
      // Explicit pglite — connectionString is the data dir (or empty/:memory:)
      const cs = this.options.connectionString ?? '';
      const dataDir = cs.startsWith('pglite://') ? cs.slice('pglite://'.length) : cs;
      await this.bootPGlite(dataDir);
    } else if (this.dialect === 'pg') {
      const cs = this.options.connectionString ?? '';
      if (cs.startsWith('pglite://')) {
        await this.bootPGlite(cs.slice('pglite://'.length));
      } else {
        await this.bootPostgres();
      }
    } else {
      await this.bootSQLite();
    }

    // 2. Resolve schemas (user overrides or defaults)
    const schemas = await this.resolveSchemas();
    this.tables = { ...schemas };

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
    this.segments = new SegmentsService(
      this.drizzle,
      this.tables as Record<string, any>,
      [...this.inlineSegments, ...(this.options.segments ?? [])],
    );
  }

  /**
   * Define a segment inline, typed against this database's schema and dialect
   * — no need to import the schema type or call `createSegmentDefiner` first.
   *
   * Inside the resolver, `tables` reflects every schema slot resolved for
   * this instance (custom + default), and `drizzle` is typed for the chosen
   * dialect so `.select().from(tables.users)` infers row shapes.
   *
   * Call before `boot()`. The segment registers into the SegmentsService
   * when boot wires services up.
   *
   *   const db = new GameDatabase({ schemas });
   *   db.defineSegment('veterans', {
   *     description: 'Level >= 10',
   *     resolve: async ({ drizzle, tables }) => {
   *       const rows = await drizzle.select({ id: tables.users.id })
   *         .from(tables.users).where(gte(tables.users.level, 10));
   *       return rows.map((r) => r.id);
   *     },
   *   });
   *   await db.boot();
   *   await db.segments.size('veterans'); // → 42
   */
  defineSegment(
    id: string,
    config: {
      description?: string;
      resolve: (
        ctx: SegmentResolveContext<ResolvedTables<S>, Dialect>,
      ) => Promise<string[]>;
    },
  ): SegmentDefinition {
    if (!id || typeof id !== 'string') {
      throw new Error('[defineSegment] id must be a non-empty string');
    }
    const def: SegmentDefinition = {
      id,
      description: config.description,
      resolve: config.resolve as SegmentDefinition['resolve'],
    };
    this.inlineSegments.push(def);
    return def;
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

  private async bootSQLite() {
    const { drizzle } = await import('drizzle-orm/node-sqlite');

    const dbPath = this.options.connectionString || 'colyseus.db';

    // Forward user options to Node's DatabaseSync via drizzle's `connection`
    // passthrough. `path` is filled from connectionString if not overridden.
    const userOpts = this.options.connection ?? {};
    this.drizzle = drizzle({ connection: { path: dbPath, ...userOpts } });

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

  private async bootPostgres() {
    const pg = (await import('postgres')).default;
    const { drizzle } = await import('drizzle-orm/postgres-js');

    const connectionString = this.options.connectionString || process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/postgres';
    // postgres-js: pass the URL positionally + any tuning opts (max, ssl,
    // idle_timeout, prepare, statement_timeout, etc.) as a second arg.
    const sql = pg(connectionString, this.options.connection);

    this.drizzle = drizzle({ client: sql });
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
  private async bootPGlite(dataDir: string) {
    const { PGlite } = await import('@electric-sql/pglite');
    const { drizzle } = await import('drizzle-orm/pglite');

    // PGliteOptions also accepts `dataDir`, so honor explicit override and
    // fall back to the value parsed from the connection string. We're in the
    // pglite path so the `connection` field is PgliteConnectionOptions.
    const userOpts = (this.options.connection ?? {}) as PgliteConnectionOptions;
    const resolvedDataDir = userOpts.dataDir ?? (
      dataDir === ':memory:' || dataDir === '' ? undefined : dataDir
    );
    const client = new PGlite({ ...userOpts, dataDir: resolvedDataDir });
    await client.waitReady;

    this.drizzle = drizzle({ client });
    this.ownedConnection = client;
    this.subDialect = 'pglite';
  }

  // -------------------------------------------------------------------------
  // Private: schema resolution and table creation
  // -------------------------------------------------------------------------

  private async resolveSchemas(): Promise<{ [K in keyof SchemaSet]: Resolve<S, K> }> {
    const userSchemas = (this.options.schemas ?? {}) as Partial<SchemaSet>;

    const defaults = this.dialect === 'pg'
      ? await import('./schemas/pg.ts')
      : await import('./schemas/sqlite.ts');

    return {
      users: userSchemas.users ?? defaults.colyseusUsers,
      configs: userSchemas.configs ?? defaults.colyseusConfigs,
      cloudSaves: userSchemas.cloudSaves ?? defaults.colyseusCloudSaves,
      leaderboards: userSchemas.leaderboards ?? defaults.colyseusLeaderboards,
      leaderboardEntries: userSchemas.leaderboardEntries ?? defaults.colyseusLeaderboardEntries,
      items: userSchemas.items ?? defaults.colyseusItems,
      playerItems: userSchemas.playerItems ?? defaults.colyseusPlayerItems,
      timedEvents: userSchemas.timedEvents ?? defaults.colyseusTimedEvents,
      analyticsEvents: userSchemas.analyticsEvents ?? defaults.colyseusAnalyticsEvents,
      userRoles: userSchemas.userRoles ?? defaults.colyseusUserRoles,
      modAssignments: userSchemas.modAssignments ?? defaults.colyseusModAssignments,
    } as { [K in keyof SchemaSet]: Resolve<S, K> };
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
    if (this.subDialect === 'postgres-js') {
      const { migrate } = await import('drizzle-orm/postgres-js/migrator');
      await migrate(this.drizzle, { migrationsFolder: folder });
    } else if (this.subDialect === 'pglite') {
      const { migrate } = await import('drizzle-orm/pglite/migrator');
      await migrate(this.drizzle, { migrationsFolder: folder });
    } else {
      const { migrate } = await import('drizzle-orm/node-sqlite/migrator');
      await migrate(this.drizzle, { migrationsFolder: folder });
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

    // Order matters: tables with FKs must come after their referenced tables.
    // Currently no schemas declare FKs (custom user-table names break .references()),
    // but the ordering is preserved as documentation of the dependency graph.
    const tables = [
      schemas.users,
      schemas.configs,
      schemas.leaderboards,
      schemas.items,
      schemas.timedEvents,
      schemas.analyticsEvents,      // userId is nullable text, no FK
      schemas.cloudSaves,           // depends on users
      schemas.leaderboardEntries,   // depends on users + leaderboards
      schemas.playerItems,          // depends on users + items
      schemas.userRoles,            // depends on users
      schemas.modAssignments,       // depends on users
    ];

    for (const table of tables) {
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
