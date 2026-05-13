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
    { name: 'leaderboardEntries', target: 'leaderboardEntries', kind: 'many', fk: 'userId' },
    { name: 'analyticsEvents', target: 'analyticsEvents', kind: 'many', fk: 'userId' },
    { name: 'role', target: 'roles', kind: 'one', fk: 'userId' },
    { name: 'notes', target: 'userNotes', kind: 'many', fk: 'userId' },
    // Reverse of `userNotes.author` — every note an admin wrote ends up
    // on their own user page under "notes authored", separate from the
    // notes filed AGAINST them which live under "notes".
    { name: 'authoredNotes', target: 'userNotes', kind: 'many', fk: 'authorId' },
  ],
  cloudSaves: [
    { name: 'user', target: 'users', kind: 'one', fk: 'userId' },
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
  roles: [
    { name: 'user', target: 'users', kind: 'one', fk: 'userId' },
  ],
  userNotes: [
    { name: 'user', target: 'users', kind: 'one', fk: 'userId' },
    // The admin who wrote the note — surfaced so support can spot "who
    // last touched this account" without an extra join.
    { name: 'author', target: 'users', kind: 'one', fk: 'authorId' },
  ],
  adminAudit: [
    // The signed-in admin (operator) who triggered the recorded
    // action. Audit rows themselves stay admin-only by RBAC policy;
    // this relation just decorates the operator-id column with a
    // link back to the users table when an admin is viewing the log.
    { name: 'operator', target: 'users', kind: 'one', fk: 'operatorId' },
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

/**
 * Resolve which side of a relation actually carries the FK column, plus
 * direct references to the relevant columns on each side.
 *
 * The `kind` discriminator (one/many) tells us cardinality but NOT which
 * side has the FK column — both shapes exist in our metadata:
 *   - `cloudSaves → user` (one): FK lives on SOURCE (cloudSaves.userId)
 *   - `users → role` (one):      FK lives on TARGET (roles.userId,
 *                                  which is itself roles' PK)
 *   - `users → cloudSaves` (many): FK lives on TARGET
 *
 * `null` when the FK column doesn't resolve on either side (typo in
 * metadata, or one of the tables hasn't been registered).
 *
 * Used by `buildRelationsCallback` to wire drizzle joins, AND by the admin
 * relation endpoint to choose between two query strategies (target-side FK
 * filters by source.PK; source-side FK requires loading the source row
 * first to read its FK value).
 */
export function resolveFkLayout(
  sourceTable: any,
  targetTable: any,
  fkJsName: string,
): {
  fkOn: 'source' | 'target';
  /** Drizzle column on whichever side carries the FK (the same as `fkJsName` resolved). */
  fkCol: any;
} | null {
  if (!sourceTable || !targetTable) { return null; }
  const onSource = sourceTable[fkJsName];
  if (onSource !== undefined && onSource !== null) {
    return { fkOn: 'source', fkCol: onSource };
  }
  const onTarget = targetTable[fkJsName];
  if (onTarget !== undefined && onTarget !== null) {
    return { fkOn: 'target', fkCol: onTarget };
  }
  return null;
}

/**
 * Translate our `RelationDefinition` metadata into a callback for drizzle's
 * `defineRelations(schema, helpers => ...)`. The result wires up
 * `db.drizzle.query.users.findMany({ with: { saves: true } })`-style joins
 * for both built-in and user-supplied relations — no parallel
 * `defineRelations(...)` authoring required.
 *
 * Direction conventions (matching the rest of the codebase):
 *   - `'many'` — children point to parent. Source PK == target.fk.
 *   - `'one'`  — source has the FK pointing at target's PK.
 *
 * Limitations (current):
 *   - Single-column primary keys only on the SOURCE side. Drizzle's `from` /
 *     `to` accept arrays for composite PKs, but our metadata only carries
 *     one fk JS field name; if you need composite-PK joins, drop down to
 *     `defineRelations(...)` directly and pass via `options.db`.
 *   - Relations whose source/target table isn't present in `tables` are
 *     silently skipped (same as the admin's catalog endpoint behavior).
 */
export function buildRelationsCallback(
  tables: Record<string, any>,
  relations: Record<string, RelationDefinition[]>,
): (h: any) => Record<string, Record<string, any>> {
  // Pre-compute each table's primary-key JS field name once. Drizzle's
  // helpers (`h.<table>.<column>`) are keyed by JS names, not SQL names.
  const pkJsNameByTable = new Map<string, string | null>();
  for (const [name, table] of Object.entries(tables)) {
    let pk: string | null = null;
    for (const [jsKey, col] of Object.entries(table)) {
      if (col && typeof col === 'object' && (col as any).primary) { pk = jsKey; break; }
    }
    pkJsNameByTable.set(name, pk);
  }

  return (h: any) => {
    const config: Record<string, Record<string, any>> = {};
    for (const [sourceName, defs] of Object.entries(relations)) {
      const sourceTable = tables[sourceName];
      if (!sourceTable) { continue; }
      for (const rel of defs) {
        const targetTable = tables[rel.target];
        if (!targetTable) { continue; }
        const sourcePk = pkJsNameByTable.get(sourceName);
        const targetPk = pkJsNameByTable.get(rel.target);

        const layout = resolveFkLayout(sourceTable, targetTable, rel.fk);
        if (!layout) { continue; }

        let from: any;
        let to: any;
        if (layout.fkOn === 'source' && targetPk) {
          // Standard child → parent: source has the FK, target has the PK.
          from = h[sourceName][rel.fk];
          to   = h[rel.target][targetPk];
        } else if (layout.fkOn === 'target' && sourcePk) {
          // Parent → child(ren): target has the FK pointing at source's PK.
          from = h[sourceName][sourcePk];
          to   = h[rel.target][rel.fk];
        } else {
          // Required PK is missing on the side without the FK — skip rather
          // than emit a half-defined relation that drizzle's
          // `defineRelations` would reject at boot.
          continue;
        }

        const builder = rel.kind === 'one' ? h.one[rel.target] : h.many[rel.target];
        (config[sourceName] ??= {})[rel.name] = builder({ from, to });
      }
    }
    return config;
  };
}
