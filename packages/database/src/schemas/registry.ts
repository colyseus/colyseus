/**
 * Registry of every built-in table that GameDatabase manages. One entry per
 * canonical schema slot (`users`, `configs`, etc.). Each dialect declares its
 * own array of `TableEntry`s — `SQLITE_TABLES` (in `./sqlite.ts`) and
 * `PG_TABLES` (in `./pg.ts`) — so dialect-specific imports stay lazy via
 * GameDatabase's dynamic-import path.
 *
 * Adding a new built-in table is now:
 *   1. Append column constants + the drizzle table to the dialect file
 *   2. Append a `TableEntry` to that file's registry
 *   3. Add the slot to `SchemaSet` (in ../types.ts) + the corresponding
 *      `…TableShape` constraint
 *   4. Add named/columns exports in ../index.ts (public API)
 *   5. Wire the new service into `GameDatabase.boot()`
 *
 * The boot machinery (`resolveSchemas` / `createTables` /
 * `alterTablesForNewColumns`) iterates the registry and no longer needs to be
 * touched for new tables.
 */
import type { SchemaSet } from '../types.ts';

export interface TableEntry<K extends keyof SchemaSet = keyof SchemaSet> {
  /** Canonical name (matches a slot in SchemaSet). */
  key: K;
  /** Drizzle table instance for this dialect. */
  table: any;
  /** Spreadable column object — re-exported from the package's `columns.*` API. */
  columns: Record<string, any>;
  /**
   * Names of other registry entries this table references via foreign key.
   * Drives table-creation order: dependencies are emitted first. No FKs are
   * declared today (custom user-table names break drizzle's `.references()`
   * relinking), so this is informational + ordering only.
   */
  dependsOn: ReadonlyArray<keyof SchemaSet>;
}

/**
 * Sort table entries so each table is preceded by everything it `dependsOn`.
 * Throws on cycles or unknown deps so a typo in `dependsOn` fails loudly at
 * boot rather than producing a CREATE TABLE that references a not-yet-created
 * table at runtime.
 */
export function topologicalSort<E extends TableEntry>(entries: ReadonlyArray<E>): E[] {
  const byKey = new Map(entries.map((e) => [e.key, e]));
  const sorted: E[] = [];
  const visited = new Set<string>();
  const visiting = new Set<string>();

  function visit(key: keyof SchemaSet, path: string[]): void {
    if (visited.has(key)) { return; }
    if (visiting.has(key)) {
      throw new Error(
        `[schemas/registry] dependency cycle: ${[...path, key].join(' → ')}`,
      );
    }
    const entry = byKey.get(key);
    if (!entry) {
      throw new Error(
        `[schemas/registry] unknown dependency '${String(key)}' (referenced by '${path[path.length - 1] ?? '?'}')`,
      );
    }
    visiting.add(key);
    for (const dep of entry.dependsOn) { visit(dep, [...path, String(key)]); }
    visiting.delete(key);
    visited.add(key);
    sorted.push(entry);
  }

  for (const entry of entries) { visit(entry.key, []); }
  return sorted;
}
