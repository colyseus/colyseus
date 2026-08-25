// In its own module so `app.config.ts` and `MyRoom.ts` share one instance
// without forming a circular import. Booted by `Server.listen()`.
import { GameDatabase } from "@colyseus/database";
import * as schema from "./schema.ts";

export const database = new GameDatabase({
  connectionString: process.env.DATABASE_URL,
  schemas: schema,
});
