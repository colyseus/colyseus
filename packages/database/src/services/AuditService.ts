import { and, desc, eq, lt } from 'drizzle-orm';
import type { AdminAuditTableShape } from '../types.ts';
import { affectedRows, type ServiceDb } from './_db.ts';

/**
 * Audit action tags. CRUD verbs cover mutations through the admin's
 * create/update/delete endpoints; `custom` is for `_action`-style
 * handlers; `auth.*` covers admin sign-in/out/bootstrap so a stolen
 * credential trail is visible in the same log as data mutations.
 */
export type AuditAction =
  | 'create'
  | 'update'
  | 'delete'
  | 'custom'
  | 'auth.login'
  | 'auth.login_failed'
  | 'auth.logout'
  | 'auth.bootstrap'
  | 'auth.password_reset_requested'
  | 'auth.password_reset_completed'
  | 'room.kick'
  | 'room.dispose'
  | 'room.lock'
  | 'room.unlock'
  | 'room.state.edit'
  | 'room.state.delete';

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
 * Column-level diff between two row snapshots. Result keys are the
 * shared/changed column names; values are `{ before, after }` pairs
 * for fields that actually differ. Untouched columns are omitted.
 *
 * Equality:
 *   - `===` for primitives
 *   - `getTime()` for Date instances
 *   - stringified for objects (good enough for audit payloads)
 *
 * Exported so game code can produce audit-shaped diffs from
 * non-admin code paths (e.g. cron jobs, scheduled migrations).
 */
export function diffRows(
  before: Record<string, any> | null | undefined,
  after: Record<string, any> | null | undefined,
): Record<string, { before: any; after: any }> {
  const out: Record<string, { before: any; after: any }> = {};
  const keys = new Set<string>([
    ...Object.keys(before ?? {}),
    ...Object.keys(after ?? {}),
  ]);
  for (const k of keys) {
    const a = before?.[k];
    const b = after?.[k];
    if (!isShallowlyEqual(a, b)) {
      out[k] = { before: a, after: b };
    }
  }
  return out;
}

function isShallowlyEqual(a: any, b: any): boolean {
  if (a === b) { return true; }
  if (a == null || b == null) { return false; }
  if (a instanceof Date && b instanceof Date) { return a.getTime() === b.getTime(); }
  if (typeof a === 'object' && typeof b === 'object') {
    try { return JSON.stringify(a) === JSON.stringify(b); }
    catch { return false; }
  }
  return false;
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
  private db: ServiceDb;
  private audit: T;

  constructor(db: ServiceDb, audit: T) {
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
   * Convenience for the common "I just updated row X, log the change"
   * pattern. Computes a column-level diff via `diffRows` and stores it
   * under `payload.changes`. Equivalent to:
   *
   *   audit.record({
   *     ...,
   *     action: 'update',
   *     payload: { changes: diffRows(before, after) },
   *   });
   */
  async recordUpdate(opts: {
    operatorId?: string | null;
    resource: string;
    targetId?: string | null;
    before: Record<string, any> | null | undefined;
    after: Record<string, any>;
  }): Promise<AuditEntry> {
    return this.record({
      operatorId: opts.operatorId ?? null,
      action: 'update',
      resource: opts.resource,
      targetId: opts.targetId ?? null,
      payload: { changes: diffRows(opts.before, opts.after) },
    });
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

    // ServiceDb returns `any` from select() — chain inference would need
    // pinning to a specific drizzle subclass and isn't worth the coupling.
    // Local `q` keeps the conditional `.where(...)` legible.
    let q = this.db.select().from(this.audit);
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
    return affectedRows(result);
  }
}
