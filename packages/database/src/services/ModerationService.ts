import { and, eq } from 'drizzle-orm';
import type { ServiceDb } from './_db.ts';

export type Role = 'admin' | 'mod' | 'user';
export type Action = 'list' | 'read' | 'create' | 'update' | 'delete';

/**
 * Three-tier RBAC with per-collection mod assignments.
 *
 * The single source of truth for both data-layer guards and the admin UI is
 * `can(userId, action, collection)`. Same policy on both sides means a mod
 * can't bypass restrictions by hitting the REST API directly when the admin
 * UI hides the action.
 *
 * Policy:
 *  - admin: can do anything
 *  - mod:   list/read/update on assigned collections only; never delete;
 *           never touch user_roles or mod_assignments even if assigned
 *  - user:  read-only on non-sensitive collections (caller decides what's
 *           sensitive — this service only enforces "no writes")
 */
import type { UserRolesTableShape, ModAssignmentsTableShape } from '../types.ts';

export class ModerationService<
  TRoles extends UserRolesTableShape = UserRolesTableShape,
  TAssignments extends ModAssignmentsTableShape = ModAssignmentsTableShape,
> {
  private db: ServiceDb;
  private userRoles: TRoles;
  private modAssignments: TAssignments;

  constructor(db: ServiceDb, userRoles: TRoles, modAssignments: TAssignments) {
    this.db = db;
    this.userRoles = userRoles;
    this.modAssignments = modAssignments;
  }

  async setRole(userId: string, role: Role): Promise<void> {
    await this.db
      .insert(this.userRoles)
      .values({ userId, role })
      .onConflictDoUpdate({ target: this.userRoles.userId, set: { role } });
  }

  async getRole(userId: string): Promise<Role> {
    const rows = await this.db
      .select({ role: this.userRoles.role })
      .from(this.userRoles)
      .where(eq(this.userRoles.userId, userId))
      .limit(1);
    return (rows[0]?.role as Role) ?? 'user';
  }

  /**
   * Assign `userId` as a mod for `collection`. Idempotent.
   * Bumps the user to role "mod" if they were "user" before.
   */
  async assignMod(userId: string, collection: string): Promise<void> {
    await this.db
      .insert(this.modAssignments)
      .values({ userId, collection })
      .onConflictDoNothing();

    const currentRole = await this.getRole(userId);
    if (currentRole === 'user') {
      await this.setRole(userId, 'mod');
    }
  }

  async unassignMod(userId: string, collection: string): Promise<void> {
    await this.db
      .delete(this.modAssignments)
      .where(and(
        eq(this.modAssignments.userId, userId),
        eq(this.modAssignments.collection, collection),
      ));
  }

  async modCollections(userId: string): Promise<string[]> {
    const rows = await this.db
      .select({ collection: this.modAssignments.collection })
      .from(this.modAssignments)
      .where(eq(this.modAssignments.userId, userId));
    return rows.map((r: { collection: string }) => r.collection);
  }

  async can(userId: string, action: Action, collection: string): Promise<boolean> {
    const role = await this.getRole(userId);
    if (role === 'admin') { return true; }

    if (role === 'mod') {
      // Role tables are off-limits to mods, even if they're assigned to them.
      if (collection === 'colyseus_user_roles' || collection === 'colyseus_mod_assignments'
        || collection === 'user_roles' || collection === 'mod_assignments') { return false; }
      const assigned = await this.modCollections(userId);
      if (!assigned.includes(collection)) { return false; }
      return action === 'list' || action === 'read' || action === 'update';
    }

    // role === 'user'
    return action === 'list' || action === 'read';
  }
}
