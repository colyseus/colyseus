import { eq, and, sql } from 'drizzle-orm';

export class VersionConflictError extends Error {
  constructor(userId: string, slot: number, expectedVersion: number) {
    super(`Version conflict for user "${userId}" slot ${slot}: expected version ${expectedVersion}`);
    this.name = 'VersionConflictError';
  }
}

export class CloudSaveService {
  constructor(
    private db: any,
    private cloudSaves: any,
  ) {}

  async save(
    userId: string,
    slot: number,
    data: any,
    expectedVersion?: number,
  ): Promise<{ version: number }> {
    if (expectedVersion !== undefined) {
      // Optimistic locking: only update if version matches
      const result = await this.db
        .update(this.cloudSaves)
        .set({
          data,
          version: expectedVersion + 1,
          updatedAt: new Date(),
        })
        .where(and(
          eq(this.cloudSaves.userId, userId),
          eq(this.cloudSaves.slot, slot),
          eq(this.cloudSaves.version, expectedVersion),
        ));

      const affected = result.changes ?? result.rowsAffected ?? result.affectedRows ?? result.count ?? 0;
      if (affected === 0) {
        throw new VersionConflictError(userId, slot, expectedVersion);
      }

      return { version: expectedVersion + 1 };
    }

    // Upsert: insert or increment version
    await this.db
      .insert(this.cloudSaves)
      .values({
        userId,
        slot,
        data,
        version: 1,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: [this.cloudSaves.userId, this.cloudSaves.slot],
        set: {
          data,
          version: sql`${this.cloudSaves.version} + 1`,
          updatedAt: new Date(),
        },
      });

    // Read back the current version
    const rows = await this.db
      .select({ version: this.cloudSaves.version })
      .from(this.cloudSaves)
      .where(and(
        eq(this.cloudSaves.userId, userId),
        eq(this.cloudSaves.slot, slot),
      ))
      .limit(1);

    return { version: rows[0]?.version ?? 1 };
  }

  async load(
    userId: string,
    slot: number,
  ): Promise<{ data: any; version: number } | null> {
    const rows = await this.db
      .select({
        data: this.cloudSaves.data,
        version: this.cloudSaves.version,
      })
      .from(this.cloudSaves)
      .where(and(
        eq(this.cloudSaves.userId, userId),
        eq(this.cloudSaves.slot, slot),
      ))
      .limit(1);

    return rows[0] ?? null;
  }

  async listSlots(
    userId: string,
  ): Promise<Array<{ slot: number; version: number; updatedAt: Date }>> {
    return await this.db
      .select({
        slot: this.cloudSaves.slot,
        version: this.cloudSaves.version,
        updatedAt: this.cloudSaves.updatedAt,
      })
      .from(this.cloudSaves)
      .where(eq(this.cloudSaves.userId, userId));
  }

  async delete(userId: string, slot: number): Promise<boolean> {
    const result = await this.db
      .delete(this.cloudSaves)
      .where(and(
        eq(this.cloudSaves.userId, userId),
        eq(this.cloudSaves.slot, slot),
      ));
    return (result.changes ?? result.rowsAffected ?? result.affectedRows ?? result.count ?? 0) > 0;
  }
}
