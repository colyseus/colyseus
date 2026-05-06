import { generateCreateTableSQL, generateAlterAddColumnSQL } from './utils.ts';
import { AuthService } from './services/AuthService.ts';
import { ConfigService } from './services/ConfigService.ts';
import { CloudSaveService } from './services/CloudSaveService.ts';
import { LeaderboardsService } from './services/LeaderboardsService.ts';
import { ItemsService } from './services/ItemsService.ts';
import { TimedEventsService } from './services/TimedEventsService.ts';
import { AnalyticsService } from './services/AnalyticsService.ts';
import { ModerationService } from './services/ModerationService.ts';

export interface GameDatabaseOptions {
  /**
   * Connection string. Determines dialect:
   * - starts with "postgres://" or "postgresql://" → PostgreSQL
   * - otherwise or omitted → SQLite (default)
   *
   * For SQLite, this is the file path (default: "colyseus.db").
   */
  connectionString?: string;

  /**
   * Provide an existing Drizzle database instance.
   * When set, connectionString is ignored and no connection is managed.
   */
  db?: any;

  /**
   * Dialect hint — required when providing a custom `db` instance.
   * Auto-detected from connectionString when not provided.
   */
  dialect?: 'sqlite' | 'pg';

  /**
   * Custom table schemas. Spread the base columns and add your own:
   *
   *   import { columns } from '@colyseus/database';
   *   const users = sqliteTable('my_users', {
   *     ...columns.sqlite.users,
   *     displayName: text('display_name'),
   *   });
   *   new GameDatabase({ schemas: { users } });
   */
  schemas?: {
    users?: any;
    configs?: any;
    cloudSaves?: any;
    leaderboards?: any;
    leaderboardEntries?: any;
    items?: any;
    playerItems?: any;
    timedEvents?: any;
    analyticsEvents?: any;
    userRoles?: any;
    modAssignments?: any;
  };
}

type Dialect = 'sqlite' | 'pg';

export class GameDatabase {
  auth: AuthService;
  config: ConfigService;
  saves: CloudSaveService;
  leaderboards: LeaderboardsService;
  items: ItemsService;
  events: TimedEventsService;
  analytics: AnalyticsService;
  moderation: ModerationService;

  /**
   * Map of resolved drizzle tables, keyed by their canonical name
   * (e.g. "users", "configs", "leaderboards" — not the colyseus_-prefixed
   * physical table name). Available after boot(). Pass into the admin
   * panel — and any other tooling that needs to introspect schemas —
   * via `tables: { ...database.tables, ...customTables }`.
   */
  tables: Record<string, any>;

  /** The underlying Drizzle database instance (available after boot). */
  drizzle: any;

  private dialect: Dialect;
  private options: GameDatabaseOptions;
  private ownedConnection: any = null;

  constructor(options: GameDatabaseOptions = {}) {
    this.options = options;

    // Detect dialect
    if (options.dialect) {
      this.dialect = options.dialect;
    } else if (options.db) {
      // When user provides db without dialect hint, default to sqlite
      this.dialect = 'sqlite';
    } else {
      this.dialect = detectDialect(options.connectionString);
    }
  }

  async boot() {
    // 1. Create or adopt Drizzle instance
    if (this.options.db) {
      this.drizzle = this.options.db;
    } else if (this.dialect === 'pg') {
      await this.bootPostgres();
    } else {
      await this.bootSQLite();
    }

    // 2. Resolve schemas (user overrides or defaults)
    const schemas = await this.resolveSchemas();
    this.tables = { ...schemas };

    // 3. Create tables (and add any missing columns to existing tables)
    await this.createTables(schemas);
    await this.alterTablesForNewColumns(schemas);

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
  }

  async shutdown() {
    if (this.ownedConnection) {
      if (this.dialect === 'pg') {
        await this.ownedConnection.end();
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

    // Let drizzle create and own the DatabaseSync connection
    this.drizzle = drizzle(dbPath);

    // Access drizzle's internal connection for pragmas and raw DDL
    this.ownedConnection = (this.drizzle as any).$client;

    // Enable WAL mode for better concurrent read performance
    this.ownedConnection.exec('PRAGMA journal_mode = WAL');
    // Enable foreign keys (off by default in SQLite)
    this.ownedConnection.exec('PRAGMA foreign_keys = ON');
  }

  private async bootPostgres() {
    const pg = (await import('postgres')).default;
    const { drizzle } = await import('drizzle-orm/postgres-js');

    const connectionString = this.options.connectionString || process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/postgres';
    const sql = pg(connectionString);

    this.drizzle = drizzle(sql);
    this.ownedConnection = sql;
  }

  // -------------------------------------------------------------------------
  // Private: schema resolution and table creation
  // -------------------------------------------------------------------------

  private async resolveSchemas() {
    const userSchemas = this.options.schemas || {};

    if (this.dialect === 'pg') {
      const defaults = await import('./schemas/pg.ts');
      return {
        users: userSchemas.users || defaults.colyseusUsers,
        configs: userSchemas.configs || defaults.colyseusConfigs,
        cloudSaves: userSchemas.cloudSaves || defaults.colyseusCloudSaves,
        leaderboards: userSchemas.leaderboards || defaults.colyseusLeaderboards,
        leaderboardEntries: userSchemas.leaderboardEntries || defaults.colyseusLeaderboardEntries,
        items: userSchemas.items || defaults.colyseusItems,
        playerItems: userSchemas.playerItems || defaults.colyseusPlayerItems,
        timedEvents: userSchemas.timedEvents || defaults.colyseusTimedEvents,
        analyticsEvents: userSchemas.analyticsEvents || defaults.colyseusAnalyticsEvents,
        userRoles: userSchemas.userRoles || defaults.colyseusUserRoles,
        modAssignments: userSchemas.modAssignments || defaults.colyseusModAssignments,
      };
    }

    const defaults = await import('./schemas/sqlite.ts');
    return {
      users: userSchemas.users || defaults.colyseusUsers,
      configs: userSchemas.configs || defaults.colyseusConfigs,
      cloudSaves: userSchemas.cloudSaves || defaults.colyseusCloudSaves,
      leaderboards: userSchemas.leaderboards || defaults.colyseusLeaderboards,
      leaderboardEntries: userSchemas.leaderboardEntries || defaults.colyseusLeaderboardEntries,
      items: userSchemas.items || defaults.colyseusItems,
      playerItems: userSchemas.playerItems || defaults.colyseusPlayerItems,
      timedEvents: userSchemas.timedEvents || defaults.colyseusTimedEvents,
      analyticsEvents: userSchemas.analyticsEvents || defaults.colyseusAnalyticsEvents,
      userRoles: userSchemas.userRoles || defaults.colyseusUserRoles,
      modAssignments: userSchemas.modAssignments || defaults.colyseusModAssignments,
    };
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
        if (this.dialect === 'pg') {
          await this.ownedConnection.unsafe(stmt);
        } else {
          this.ownedConnection.exec(stmt);
        }
      }
    }
  }

  private async fetchExistingColumns(tableName: string): Promise<Set<string>> {
    if (this.dialect === 'pg') {
      const rows = await this.ownedConnection`
        SELECT column_name AS name
        FROM information_schema.columns
        WHERE table_name = ${tableName}
      `;
      return new Set(rows.map((r: { name: string }) => r.name));
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
          await this.ownedConnection.unsafe(sql);
        } catch (error: any) {
          // Ignore "already exists" errors for concurrent boot
          if (error?.code !== '42P07' && error?.code !== '42710') {
            throw error;
          }
        }
      } else {
        // SQLite: exec on the raw DatabaseSync connection
        this.ownedConnection.exec(sql);
      }
    }
  }
}

function detectDialect(connectionString?: string): Dialect {
  if (!connectionString) { return 'sqlite'; }
  if (connectionString.startsWith('postgres://') || connectionString.startsWith('postgresql://')) { return 'pg'; }
  return 'sqlite';
}
