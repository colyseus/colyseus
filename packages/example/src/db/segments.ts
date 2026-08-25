/**
 * Live-ops segments — declarative cohorts of players, registered against
 * the GameDatabase passed in. Imported by app.config.ts after constructing
 * the DB so `db.segments.define(...)` infers `tables` + `drizzle` from the
 * instance's own schema generic — no separate schema-type import needed.
 *
 * All three of these segments are predicates over the users table, so
 * they use `where` (composable into count(*) / EXISTS / paginated SELECT)
 * instead of `resolve` (materializes the full list). Switch to `resolve`
 * only when a cohort can't be expressed as a single users-table predicate
 * (e.g. cross-table aggregates that need joins or window functions).
 */
import type { GameDatabase } from "@colyseus/database";
import { eq, gte, lt, and } from "drizzle-orm";
import type * as schema from "./schema.ts";

export function registerSegments(db: GameDatabase<typeof schema>) {
  /** Newly registered players (level still 1 — i.e. tutorial cohort). */
  db.segments.define("newPlayers", {
    description: "Just signed up — still on level 1",
    where: ({ tables }) => eq(tables.users.level, 1),
  });

  /** Active players who completed the tutorial. */
  db.segments.define("veterans", {
    description: "Level >= 10",
    where: ({ tables }) => gte(tables.users.level, 10),
  });

  /** Mid-tier players — between tutorial and veterans. */
  db.segments.define("climbing", {
    description: "Level 2-9 — past tutorial, not yet veteran",
    where: ({ tables }) =>
      and(gte(tables.users.level, 2), lt(tables.users.level, 10)),
  });
}
