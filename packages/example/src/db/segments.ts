/**
 * Live-ops segments — declarative cohorts of players. Imported into
 * GameDatabase via `segments: [...]` so admin tools and broadcast/mail/AB
 * features can target them by id.
 *
 * Resolvers re-run against the live DB each call. For expensive segments,
 * cache externally (e.g. a cron snapshot).
 */
import { defineSegment } from "@colyseus/database";
import { eq, gte, lt, and } from "drizzle-orm";

/** Newly registered players (level still 1 — i.e. tutorial cohort). */
export const newPlayers = defineSegment("newPlayers", {
  description: "Just signed up — still on level 1",
  resolve: async ({ drizzle, tables }) => {
    const rows = await drizzle
      .select({ id: tables.users.id })
      .from(tables.users)
      .where(eq(tables.users.level, 1));
    return rows.map((r: { id: string }) => r.id);
  },
});

/** Active players who completed the tutorial. */
export const veterans = defineSegment("veterans", {
  description: "Level >= 10",
  resolve: async ({ drizzle, tables }) => {
    const rows = await drizzle
      .select({ id: tables.users.id })
      .from(tables.users)
      .where(gte(tables.users.level, 10));
    return rows.map((r: { id: string }) => r.id);
  },
});

/** Mid-tier players — between tutorial and veterans. */
export const climbing = defineSegment("climbing", {
  description: "Level 2-9 — past tutorial, not yet veteran",
  resolve: async ({ drizzle, tables }) => {
    const rows = await drizzle
      .select({ id: tables.users.id })
      .from(tables.users)
      .where(and(gte(tables.users.level, 2), lt(tables.users.level, 10)));
    return rows.map((r: { id: string }) => r.id);
  },
});
