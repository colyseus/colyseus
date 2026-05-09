import { and, desc, eq, lt } from 'drizzle-orm';
import type { AdminAuditTableShape } from '../types.ts';

export type AuditAction = 'create' | 'update' | 'delete' | 'custom';

export interface AuditEntry {
  id: string;
  operatorId: string | null;
  action: string;
  resource: string;
  targetId: string | null;
  payload: any;
  createdAt: Date;
}

/**
 * Append-only log of admin actions. Used by the admin's
 * Create/Update/Delete/custom-action endpoints to record who did what,
 * when, and to which row. Reads are cheap (paginated, indexed by
 * resource + createdAt); writes are fire-and-forget — the calling
 * endpoint shouldn't fail just because the audit insert did.
 *
 * For high-volume games, retention is the operator's responsibility.
 * Provide `prune(before)` so a cron can drop entries older than N
 * days.
 */
export class AuditService<T extends AdminAuditTableShape = AdminAuditTableShape> {
  private db: any;
  private audit: T;

  constructor(db: any, audit: T) {
    this.db = db;
    this.audit = audit;
  }

  /**
   * Record a single audit entry. Designed to be called from inside
   * admin endpoint handlers — wraps in try/catch in callers since
   * we don't want a logger failure to break the user's mutation.
   */
  async record(entry: {
    operatorId?: string | null;
    action: AuditAction;
    resource: string;
    targetId?: string | null;
    payload?: unknown;
  }): Promise<AuditEntry> {
    const [row] = await this.db
      .insert(this.audit)
      .values({
        operatorId: entry.operatorId ?? null,
        action: entry.action,
        resource: entry.resource,
        targetId: entry.targetId ?? null,
        payload: entry.payload ?? null,
      })
      .returning();
    return row as AuditEntry;
  }

  /**
   * List entries newest-first, optionally filtered by operator and/or
   * resource. The cursor-style `before` lets a UI paginate without
   * skipping concurrent inserts.
   */
  async list(opts: {
    operatorId?: string;
    resource?: string;
    before?: Date;
    limit?: number;
  } = {}): Promise<AuditEntry[]> {
    const limit = opts.limit ?? 100;
    const conds: any[] = [];
    if (opts.operatorId) { conds.push(eq(this.audit.operatorId, opts.operatorId)); }
    if (opts.resource) { conds.push(eq(this.audit.resource, opts.resource)); }
    if (opts.before) { conds.push(lt(this.audit.createdAt, opts.before)); }

    let q = this.db.select().from(this.audit) as any;
    if (conds.length === 1) { q = q.where(conds[0]); }
    else if (conds.length > 1) { q = q.where(and(...conds)); }
    q = q.orderBy(desc(this.audit.createdAt), desc(this.audit.id)).limit(limit);
    return q as Promise<AuditEntry[]>;
  }

  /** Drop entries older than `before`. Returns the number of rows removed. */
  async prune(before: Date): Promise<number> {
    const result = await this.db
      .delete(this.audit)
      .where(lt(this.audit.createdAt, before));
    return Number(
      (result as any)?.changes
        ?? (result as any)?.rowsAffected
        ?? (result as any)?.affectedRows
        ?? (result as any)?.count
        ?? 0,
    );
  }
}
