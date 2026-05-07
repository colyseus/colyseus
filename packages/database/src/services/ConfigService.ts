import { eq, sql } from 'drizzle-orm';

export class ConfigService {
  private db: any;
  private configs: any;

  constructor(db: any, configs: any) {
    this.db = db;
    this.configs = configs;
  }

  async get<T = any>(key: string): Promise<T | null> {
    const rows = await this.db
      .select()
      .from(this.configs)
      .where(eq(this.configs.key, key))
      .limit(1);

    return rows[0]?.value ?? null;
  }

  async set<T = any>(key: string, value: T): Promise<void> {
    await this.db
      .insert(this.configs)
      .values({
        key,
        value,
        version: 1,
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: this.configs.key,
        set: {
          value,
          version: sql`${this.configs.version} + 1`,
          updatedAt: new Date(),
        },
      });
  }

  async getAll(): Promise<Record<string, any>> {
    const rows = await this.db.select().from(this.configs);
    const result: Record<string, any> = {};
    for (const row of rows) {
      result[row.key] = row.value;
    }
    return result;
  }

  async delete(key: string): Promise<boolean> {
    const result = await this.db
      .delete(this.configs)
      .where(eq(this.configs.key, key));
    return (result.changes ?? result.rowsAffected ?? result.count ?? 0) > 0;
  }
}
