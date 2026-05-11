/**
 * Shared GameDatabase singleton. Lives in its own module so both
 * `app.config.ts` (admin endpoints, seeding) and `MyRoom.ts` (database
 * plugins) can consume it without forming a circular import.
 *
 * `boot()` is initiated here and awaited in `app.config.ts` before the
 * server starts listening.
 */
import { GameDatabase } from "@colyseus/database";
import * as schema from "./schema.ts";

export const database = new GameDatabase({
  connectionString: process.env.DATABASE_URL,
  schemas: schema,
});

export const databaseBoot = database.boot();
