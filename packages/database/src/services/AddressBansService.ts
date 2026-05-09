import { and, desc, eq, gt, isNotNull, isNull, lte, or, type SQL } from 'drizzle-orm';
import type { BannedAddressesTableShape } from '../types.ts';

export interface AddressBan {
  id: string;
  kind: string;
  value: string;
  reason: string | null;
  until: Date | null;
  createdBy: string | null;
  createdAt: Date;
}

/**
 * Bans on connection-source identifiers — IPs, device fingerprints,
 * install ids, anything else games want to use as a per-connection
 * identifier. Independent of per-user bans (see AuthService.ban):
 * a banned IP rejects every account that connects from it; a banned
 * user is rejected even from a clean IP.
 *
 * The `kind` field is a free tag so games can use whatever
 * fingerprint scheme they need. `'ip'` and `'device'` are the
 * conventional values.
 *
 * Wiring into the auth flow: call `isBanned(kind, value)` from your
 * sign-in / connect handler, returning a 403 when banned. The IP
 * itself isn't auto-resolved here — it depends on transport
 * (X-Forwarded-For under a proxy, the raw socket otherwise) — so the
 * caller is responsible for extracting the value.
 */
export class AddressBansService<T extends BannedAddressesTableShape = BannedAddressesTableShape> {
  private db: any;
  private bans: T;

  constructor(db: any, bans: T) {
    this.db = db;
    this.bans = bans;
  }

  /**
   * Ban a (kind, value) tuple. If the tuple is already banned, the
   * existing row is overwritten so the operator can update reason / until
   * with a single call.
   */
  async ban(
    kind: string,
    value: string,
    opts: { reason?: string; until?: Date | null; createdBy?: string | null } = {},
  ): Promise<AddressBan> {
    const existing = await this.db
      .select({ id: this.bans.id })
      .from(this.bans)
      .where(and(eq(this.bans.kind, kind), eq(this.bans.value, value)))
      .limit(1);

    if (existing[0]) {
      const [row] = await this.db
        .update(this.bans)
        .set({
          reason: opts.reason ?? null,
          until: opts.until ?? null,
          createdBy: opts.createdBy ?? null,
          createdAt: new Date(),
        })
        .where(eq(this.bans.id, existing[0].id))
        .returning();
      return row as AddressBan;
    }

    const [row] = await this.db
      .insert(this.bans)
      .values({
        kind,
        value,
        reason: opts.reason ?? null,
        until: opts.until ?? null,
        createdBy: opts.createdBy ?? null,
      })
      .returning();
    return row as AddressBan;
  }

  /** Remove a ban. Idempotent — missing tuples are a no-op. */
  async unban(kind: string, value: string): Promise<void> {
    await this.db
      .delete(this.bans)
      .where(and(eq(this.bans.kind, kind), eq(this.bans.value, value)));
  }

  /**
   * True if a (kind, value) tuple is currently banned. Permanent bans
   * (until = NULL) and unexpired timed bans both return true; expired
   * timed bans return false (but stay in the table for audit; prune via
   * `pruneExpired`).
   */
  async isBanned(kind: string, value: string, at: Date = new Date()): Promise<boolean> {
    const orExpr: SQL = or(
      isNull(this.bans.until),
      gt(this.bans.until, at),
    ) as SQL;
    const rows = await this.db
      .select({ id: this.bans.id })
      .from(this.bans)
      .where(and(eq(this.bans.kind, kind), eq(this.bans.value, value), orExpr))
      .limit(1);
    return rows.length > 0;
  }

  /** All currently-active bans for a kind, newest first. */
  async list(kind?: string, at: Date = new Date()): Promise<AddressBan[]> {
    const orExpr: SQL = or(
      isNull(this.bans.until),
      gt(this.bans.until, at),
    ) as SQL;
    const where = kind ? and(eq(this.bans.kind, kind), orExpr) : orExpr;
    return this.db
      .select()
      .from(this.bans)
      .where(where)
      .orderBy(desc(this.bans.createdAt), desc(this.bans.id)) as Promise<AddressBan[]>;
  }

  /** Drop expired bans. Returns the number of rows removed. */
  async pruneExpired(at: Date = new Date()): Promise<number> {
    // Use drizzle's column-aware operators rather than raw `sql`...
    // the column is timestamp_ms / timestamp; raw template doesn't
    // serialize the JS Date for either dialect, drizzle's lte does.
    const result = await this.db
      .delete(this.bans)
      .where(and(isNotNull(this.bans.until), lte(this.bans.until, at)));
    return Number(
      (result as any)?.changes
        ?? (result as any)?.rowsAffected
        ?? (result as any)?.affectedRows
        ?? (result as any)?.count
        ?? 0,
    );
  }
}
