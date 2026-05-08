/**
 * Live-ops segments — declarative cohorts of players, registered against
 * the GameDatabase passed in. Imported by app.config.ts after constructing
 * the DB so `db.segments.define(...)` infers `tables` + `drizzle` from the
 * instance's own schema generic — no separate schema-type import needed.
 *
 * The function takes the database typed against our schema barrel so each
 * resolver gets full autocomplete on `tables.users.level`, etc.
 */
import type { GameDatabase } from "@colyseus/database";
import { eq, gte, lt, and } from "drizzle-orm";
import type * as schema from "./schema.ts";

export function registerSegments(db: GameDatabase<typeof schema>) {
  /** Newly registered players (level still 1 — i.e. tutorial cohort). */
  db.segments.define("newPlayers", {
    description: "Just signed up — still on level 1",
    resolve: async ({ drizzle, tables }) => {
      const rows = await drizzle
        .select({ id: tables.users.id })
        .from(tables.users)
        .where(eq(tables.users.level, 1));
      return rows.map((r) => r.id);
    },
  });

  /** Active players who completed the tutorial. */
  db.segments.define("veterans", {
    description: "Level >= 10",
    resolve: async ({ drizzle, tables }) => {
      const rows = await drizzle
        .select({ id: tables.users.id })
        .from(tables.users)
        .where(gte(tables.users.level, 10));
      return rows.map((r) => r.id);
    },
  });

  /** Mid-tier players — between tutorial and veterans. */
  db.segments.define("climbing", {
    description: "Level 2-9 — past tutorial, not yet veteran",
    resolve: async ({ drizzle, tables }) => {
      const rows = await drizzle
        .select({ id: tables.users.id })
        .from(tables.users)
        .where(and(gte(tables.users.level, 2), lt(tables.users.level, 10)));
      return rows.map((r) => r.id);
    },
  });
}
