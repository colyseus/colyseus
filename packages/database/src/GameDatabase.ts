import { generateCreateTableSQL } from './utils.ts';
import { AuthService } from './services/AuthService.ts';
import { ConfigService } from './services/ConfigService.ts';
import { CloudSaveService } from './services/CloudSaveService.ts';

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
  };
}

type Dialect = 'sqlite' | 'pg';

export class GameDatabase {
  auth: AuthService;
  config: ConfigService;
  saves: CloudSaveService;

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

    // 3. Create tables
    await this.createTables(schemas);

    // 4. Instantiate services
    this.auth = new AuthService(this.drizzle, schemas.users);
    this.config = new ConfigService(this.drizzle, schemas.configs);
    this.saves = new CloudSaveService(this.drizzle, schemas.cloudSaves);
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
      };
    }

    const defaults = await import('./schemas/sqlite.ts');
    return {
      users: userSchemas.users || defaults.colyseusUsers,
      configs: userSchemas.configs || defaults.colyseusConfigs,
      cloudSaves: userSchemas.cloudSaves || defaults.colyseusCloudSaves,
    };
  }

  private async createTables(schemas: { users: any; configs: any; cloudSaves: any }) {
    const getTableConfig: (table: any) => any = this.dialect === 'pg'
      ? (await import('drizzle-orm/pg-core')).getTableConfig
      : (await import('drizzle-orm/sqlite-core')).getTableConfig;

    // Users must be created first (cloud_saves has a FK to users)
    const tables = [schemas.users, schemas.configs, schemas.cloudSaves];

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
