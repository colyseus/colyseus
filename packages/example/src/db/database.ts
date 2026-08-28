// In its own module so `app.config.ts` and `MyRoom.ts` share one instance
// without forming a circular import. Booted by `Server.listen()`.
import { GameDatabase } from "@colyseus/database";
import * as schema from "./schema.ts";
import { registerSegments } from "./segments.ts";

export const database = new GameDatabase({
  connectionString: process.env.DATABASE_URL,
  schemas: schema,
});

// Here rather than in each entry: `segments.define()` throws on a duplicate
// id, and must run before boot() — a pairing every entry would have to
// remember on its own.
registerSegments(database);
