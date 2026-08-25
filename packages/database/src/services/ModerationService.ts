import { eq } from 'drizzle-orm';
import type { ServiceDb } from './_db.ts';
import type { RolesTableShape } from '../types.ts';

export type Role = 'admin' | 'mod' | 'user';
export type Action = 'list' | 'read' | 'create' | 'update' | 'delete';

/**
 * Three-tier RBAC backed by a single `roles` table. Every row is
 * `(userId, role, scopes)`:
 *
 *   role:   'admin' | 'mod' | 'user'
 *   scopes: collection names this user can act on (only meaningful for
 *           mods — admins implicitly cover everything; users are
 *           read-only on whatever the caller passes to `can()`).
 *
 * Single source of truth for both the data-layer guards and the admin
 * UI is `can(userId, action, collection)`. Same policy on both sides
 * means a mod can't bypass restrictions by hitting the REST API
 * directly when the admin UI hides the action.
 *
 * Policy:
 *  - admin: can do anything
 *  - mod:   list / read / update on scoped collections only; never
 *           delete; never touch the roles table even if scoped onto it
 *  - user:  read-only (the caller decides what's sensitive — this
 *           service only enforces "no writes")
 */
export class ModerationService<T extends RolesTableShape = RolesTableShape> {
  private db: ServiceDb;
  private roles: T;

  constructor(db: ServiceDb, roles: T) {
    this.db = db;
    this.roles = roles;
  }

  /**
   * Set a user's role. Preserves existing `scopes` so promoting
   * user→mod doesn't wipe a previously-assigned collection list.
   * The framework defaults `scopes` to `[]` on first insert.
   */
  async setRole(userId: string, role: Role): Promise<void> {
    await this.db
      .insert(this.roles)
      .values({ userId, role, scopes: [] })
      .onConflictDoUpdate({ target: this.roles.userId, set: { role } });
  }

  async getRole(userId: string): Promise<Role> {
    const rows = await this.db
      .select({ role: this.roles.role })
      .from(this.roles)
      .where(eq(this.roles.userId, userId))
      .limit(1);
    return (rows[0]?.role as Role) ?? 'user';
  }

  /**
   * Add `collection` to the user's scopes. Idempotent — if the
   * collection is already present, this is a no-op. Promotes the
   * user from 'user' to 'mod' on first assignment so the caller
   * doesn't have to call `setRole` separately.
   */
  async assignMod(userId: string, collection: string): Promise<void> {
    const row = await this.#loadRow(userId);
    const role: Role = row?.role === 'admin' ? 'admin' : 'mod';
    const existing = row?.scopes ?? [];
    if (existing.includes(collection)) {
      // Still ensure the role is correct (promote 'user' → 'mod').
      if (role !== row?.role) {
        await this.db
          .update(this.roles)
          .set({ role })
          .where(eq(this.roles.userId, userId));
      }
      return;
    }
    const next = [...existing, collection];
    await this.db
      .insert(this.roles)
      .values({ userId, role, scopes: next })
      .onConflictDoUpdate({
        target: this.roles.userId,
        set: { role, scopes: next },
      });
  }

  /**
   * Remove `collection` from the user's scopes. No-op if the user
   * isn't scoped to it (or has no row at all). Does NOT demote a
   * mod with zero scopes back to 'user' — that's an explicit
   * `setRole(userId, 'user')` call.
   */
  async unassignMod(userId: string, collection: string): Promise<void> {
    const row = await this.#loadRow(userId);
    if (!row) { return; }
    const next = (row.scopes ?? []).filter((c) => c !== collection);
    if (next.length === (row.scopes ?? []).length) { return; }
    await this.db
      .update(this.roles)
      .set({ scopes: next })
      .where(eq(this.roles.userId, userId));
  }

  /**
   * List the collections a user is scoped to. Empty array if the
   * user has no row, or has a row but no scopes.
   */
  async modCollections(userId: string): Promise<string[]> {
    const row = await this.#loadRow(userId);
    return row?.scopes ?? [];
  }

  async can(userId: string, action: Action, collection: string): Promise<boolean> {
    const row = await this.#loadRow(userId);
    const role: Role = (row?.role as Role | undefined) ?? 'user';

    if (role === 'admin') { return true; }

    if (role === 'mod') {
      // The roles table itself is off-limits to mods, even if they're
      // scoped to it — that prevents privilege escalation.
      if (collection === 'colyseus_roles' || collection === 'roles') { return false; }
      const scopes = row?.scopes ?? [];
      if (!scopes.includes(collection)) { return false; }
      return action === 'list' || action === 'read' || action === 'update';
    }

    // role === 'user'
    return action === 'list' || action === 'read';
  }

  // ---- private --------------------------------------------------------

  async #loadRow(userId: string): Promise<{ role: Role; scopes: string[] } | undefined> {
    const rows = await this.db
      .select({ role: this.roles.role, scopes: this.roles.scopes })
      .from(this.roles)
      .where(eq(this.roles.userId, userId))
      .limit(1);
    if (!rows[0]) { return undefined; }
    return {
      role: rows[0].role as Role,
      scopes: (rows[0].scopes ?? []) as string[],
    };
  }
}

