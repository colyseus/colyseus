/**
 * Static foreign-key metadata between the package's tables.
 *
 * The admin engine reads this map to:
 *   - List related resources on each detail page (tabs / badges)
 *   - Build paginated queries for `GET /admin-api/:resource/:id/relations/:name`
 *   - Pre-fill FK columns when creating a related row from a parent context
 *
 * This is a metadata-level abstraction, not drizzle's relations() API.
 * Drizzle 1.0's `defineRelations(schema, builder)` is the way to enable
 * `db.drizzle.query.users.findFirst({ with: ... })`, but we don't need
 * its query API here — straight `SELECT * FROM <target> WHERE <fk> = :id`
 * is enough for the admin's relationship-aware UI and works across every
 * dialect without dragging in drizzle's relations type machinery.
 *
 * Users extend with their own (e.g. users → guilds) via the `relations`
 * option on GameDatabase.
 */

export type RelationKind = 'one' | 'many';

export interface RelationDefinition {
  /** Display name on the detail page (also the URL slug at the relation endpoint). */
  name: string;
  /** Canonical name of the target table — must match a key in `db.tables`. */
  target: string;
  /** `'many'` → tab with paginated list. `'one'` → clickable badge. */
  kind: RelationKind;
  /**
   * Foreign-key column on the target table that points back to the source's
   * primary key. The admin uses this to build `WHERE <fk> = :id` queries.
   * Pass the JS field name (drizzle column property), not the SQL column name.
   */
  fk: string;
}

/**
 * Built-in relations keyed by source table (canonical name from db.tables).
 * Both directions are declared so the admin can render context wherever
 * the user lands — viewing a cloud_save shows a back-link to its user, and
 * viewing a user shows the list of their saves.
 */
export const builtInRelations: Record<string, RelationDefinition[]> = {
  users: [
    { name: 'cloudSaves', target: 'cloudSaves', kind: 'many', fk: 'userId' },
    { name: 'playerItems', target: 'playerItems', kind: 'many', fk: 'userId' },
    { name: 'leaderboardEntries', target: 'leaderboardEntries', kind: 'many', fk: 'userId' },
    { name: 'analyticsEvents', target: 'analyticsEvents', kind: 'many', fk: 'userId' },
    { name: 'role', target: 'userRoles', kind: 'one', fk: 'userId' },
    { name: 'modAssignments', target: 'modAssignments', kind: 'many', fk: 'userId' },
    { name: 'notes', target: 'userNotes', kind: 'many', fk: 'userId' },
  ],
  cloudSaves: [
    { name: 'user', target: 'users', kind: 'one', fk: 'userId' },
  ],
  playerItems: [
    { name: 'user', target: 'users', kind: 'one', fk: 'userId' },
    { name: 'item', target: 'items', kind: 'one', fk: 'itemId' },
  ],
  items: [
    { name: 'playerItems', target: 'playerItems', kind: 'many', fk: 'itemId' },
  ],
  leaderboardEntries: [
    { name: 'user', target: 'users', kind: 'one', fk: 'userId' },
    { name: 'board', target: 'leaderboards', kind: 'one', fk: 'boardId' },
  ],
  leaderboards: [
    { name: 'entries', target: 'leaderboardEntries', kind: 'many', fk: 'boardId' },
  ],
  analyticsEvents: [
    { name: 'user', target: 'users', kind: 'one', fk: 'userId' },
  ],
  userRoles: [
    { name: 'user', target: 'users', kind: 'one', fk: 'userId' },
  ],
  modAssignments: [
    { name: 'user', target: 'users', kind: 'one', fk: 'userId' },
  ],
  userNotes: [
    { name: 'user', target: 'users', kind: 'one', fk: 'userId' },
  ],
};

/**
 * Merge user-supplied relations onto the built-ins. Same-name entries on the
 * same source table replace the built-in (lets users hide a noisy default by
 * overriding it with their own narrower version).
 */
export function mergeRelations(
  user: Record<string, RelationDefinition[]> | undefined,
): Record<string, RelationDefinition[]> {
  if (!user) { return builtInRelations; }
  const merged: Record<string, RelationDefinition[]> = {};
  for (const [k, v] of Object.entries(builtInRelations)) {
    merged[k] = [...v];
  }
  for (const [source, defs] of Object.entries(user)) {
    const existing = merged[source] ?? [];
    const byName = new Map<string, RelationDefinition>(existing.map((d) => [d.name, d]));
    for (const d of defs) { byName.set(d.name, d); }
    merged[source] = [...byName.values()];
  }
  return merged;
}
