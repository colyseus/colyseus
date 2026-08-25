/**
 * Typed configs registry. Pair a string key with a Standard Schema
 * validator (zod, valibot, yup, etc.) and the framework will:
 *
 *   - validate the row on read (falling back to schema defaults when
 *     the stored value is missing or malformed)
 *   - validate the input on write (rejecting bad payloads before they
 *     hit the database)
 *   - thread the inferred value type through `db.configs.get(key)` so
 *     room code gets autocomplete + type-checking
 *   - render structured forms in the admin panel based on the schema
 *
 * The registry is declared once and passed into `GameDatabase` via the
 * `configsRegistry` option. Keys present here are typed; unknown keys
 * still work via the loose `(key: string) => any` overload.
 *
 *   import { defineConfigs } from '@colyseus/database';
 *   import { z } from 'zod';
 *
 *   export const configsRegistry = defineConfigs({
 *     matchmaking: z.object({
 *       minPlayers: z.number().int().min(1).default(2),
 *       maxPlayers: z.number().int().max(64).default(10),
 *       queueTimeoutMs: z.number().int().default(30_000),
 *     }),
 *     features: z.object({
 *       doubleXP: z.boolean().default(false),
 *     }),
 *   });
 *
 *   const db = new GameDatabase({ configsRegistry, presence });
 *   const mm = await db.configs.get('matchmaking');
 *   //    ^ typed { minPlayers: number; maxPlayers: number; queueTimeoutMs: number }
 */
import type { StandardSchemaV1 } from '@standard-schema/spec';

/** A map from config key → Standard Schema validator. */
export type ConfigsRegistry = Record<string, StandardSchemaV1>;

/**
 * Identity helper that preserves the literal key types via the `const T`
 * modifier — so `keyof typeof registry` is `'matchmaking' | 'features'`
 * rather than `string`.
 */
export function defineConfigs<const T extends ConfigsRegistry>(registry: T): T {
  return registry;
}

/** Inferred value type for a key in a registry. */
export type ConfigValue<R extends ConfigsRegistry, K extends keyof R> =
  StandardSchemaV1.InferOutput<R[K]>;

/** Materialized "all configs as one object" type. */
export type AllConfigs<R extends ConfigsRegistry> = {
  [K in keyof R]: ConfigValue<R, K>;
};
