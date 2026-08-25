import { eq, sql } from 'drizzle-orm';
import type { StandardSchemaV1 } from '@standard-schema/spec';
import type { Presence } from '@colyseus/core';
import type { ConfigsTableShape } from '../types.ts';
import type { ConfigsRegistry, ConfigValue, AllConfigs } from '../configs.ts';
import { affectedRows, type ServiceDb } from './_db.ts';

/**
 * Presence pub/sub channel name. One channel for all keys — the
 * payload carries the key, so subscribers route locally. This avoids
 * the channel-explosion problem of one-channel-per-key.
 */
const INVALIDATION_CHANNEL = 'colyseus:configs:update';

type Listener = (value: any) => void;

interface InvalidationMessage {
  key: string;
  value: unknown;
}

export interface ConfigServiceOptions<R extends ConfigsRegistry> {
  /** Typed schema registry — see `defineConfigs`. */
  registry?: R;

  /**
   * Cross-instance notification channel. When `set()` is called on one
   * server, others subscribed to the same Presence see the new value
   * and refresh their in-memory caches. Without `presence`, the cache
   * is per-process — admin edits won't propagate to running rooms
   * until they call `get()` after a (currently-not-implemented)
   * invalidation, so a multi-process deployment needs it.
   */
  presence?: Presence;

  /**
   * Override the Presence channel name. Default
   * `'colyseus:configs:update'`. Useful if multiple GameDatabase
   * instances share a Presence and need isolated invalidation lanes.
   */
  channel?: string;
}

/**
 * Live config service — typed reads via the registry, in-memory cache,
 * cross-process invalidation via Colyseus Presence, and a subscribe()
 * API for reactive code inside rooms.
 *
 * Lifecycle:
 *   - construct with `{ registry, presence }`. The constructor immediately
 *     subscribes to the invalidation channel; no `init()` step needed.
 *   - `get(key)` is async — the first read for a key hits the DB,
 *     subsequent reads return from the in-memory map.
 *   - `set(key, value)` validates → DB upsert → local cache write →
 *     local subscriber notifications → Presence publish (other instances).
 *   - `subscribe(key, cb)` registers a local listener. The callback fires
 *     for both `set()` calls on this instance and invalidation messages
 *     from other instances. Returns an unsubscribe function.
 *   - `shutdown()` unsubscribes from Presence and clears state.
 */
export class ConfigService<
  T extends ConfigsTableShape = ConfigsTableShape,
  R extends ConfigsRegistry = {},
> {
  private db: ServiceDb;
  private configs: T;
  private registry: R;
  private presence?: Presence;
  private channel: string;
  private presenceCallback?: (msg: InvalidationMessage) => void;
  private cache = new Map<string, any>();
  private listeners = new Map<string, Set<Listener>>();

  constructor(db: ServiceDb, configs: T, options: ConfigServiceOptions<R> = {}) {
    this.db = db;
    this.configs = configs;
    this.registry = (options.registry ?? {}) as R;
    this.presence = options.presence;
    this.channel = options.channel ?? INVALIDATION_CHANNEL;

    if (this.presence) {
      this.presenceCallback = (msg) => this.#handleInvalidation(msg);
      this.presence.subscribe(this.channel, this.presenceCallback);
    }
  }

  /**
   * Read a typed config value. Hits the cache when populated; otherwise
   * loads from the DB and validates against the registered schema. A
   * missing/malformed row falls back to the schema's default value
   * (when one is declared), so room code never sees `null` for a
   * registered key with a default.
   */
  async get<K extends Extract<keyof R, string>>(key: K): Promise<ConfigValue<R, K>>;
  /** Untyped fallback when no schema is registered for the key. */
  async get<V = any>(key: string): Promise<V | null>;
  async get(key: string): Promise<any> {
    if (this.cache.has(key)) { return this.cache.get(key); }

    const rows = await this.db
      .select()
      .from(this.configs)
      .where(eq(this.configs.key, key))
      .limit(1);
    const raw = rows[0]?.value;

    const schema = this.registry[key];
    if (!schema) {
      // Untyped — store and return whatever was in the row.
      const val = raw ?? null;
      this.cache.set(key, val);
      return val;
    }

    // Validate. If the stored value is invalid, fall back to schema
    // defaults by validating `undefined` (zod's .default() applies).
    const validated = await validate(schema, raw);
    if (!validated.issues) {
      this.cache.set(key, validated.value);
      return validated.value;
    }
    const defaults = await validate(schema, undefined);
    const fallback = defaults.issues ? undefined : defaults.value;
    this.cache.set(key, fallback);
    return fallback;
  }

  /**
   * Write a config value. Validates against the registered schema (when
   * one is registered for the key), upserts the row, refreshes the
   * local cache, fires local subscribers, then publishes the change
   * to other instances via Presence.
   *
   * Throws on validation failure — bad payloads never reach the DB.
   */
  async set<K extends Extract<keyof R, string>>(key: K, value: ConfigValue<R, K>): Promise<void>;
  async set(key: string, value: any): Promise<void>;
  async set(key: string, value: any): Promise<void> {
    const schema = this.registry[key];
    if (schema) {
      const validated = await validate(schema, value);
      if (validated.issues) {
        throw new Error(
          `[ConfigService] validation failed for "${key}": ${JSON.stringify(validated.issues)}`,
        );
      }
      value = validated.value;
    }

    await this.db
      .insert(this.configs)
      .values({ key, value, version: 1, updatedAt: new Date() })
      .onConflictDoUpdate({
        target: this.configs.key,
        set: {
          value,
          version: sql`${this.configs.version} + 1`,
          updatedAt: new Date(),
        },
      });

    this.cache.set(key, value);
    this.#notify(key, value);

    if (this.presence) {
      await this.presence.publish(this.channel, { key, value });
    }
  }

  /**
   * Subscribe to changes for a single key. The callback fires for both
   * `set()` calls on this instance and invalidation messages received
   * from other instances. Returns an unsubscribe function.
   */
  subscribe<K extends Extract<keyof R, string>>(
    key: K,
    callback: (value: ConfigValue<R, K>) => void,
  ): () => void;
  subscribe(key: string, callback: (value: any) => void): () => void;
  subscribe(key: string, callback: (value: any) => void): () => void {
    let set = this.listeners.get(key);
    if (!set) {
      set = new Set();
      this.listeners.set(key, set);
    }
    set.add(callback);
    return () => { this.listeners.get(key)?.delete(callback); };
  }

  /**
   * Load every config — registered keys default-fill if no row exists,
   * unregistered keys are returned as-is. Cache is bypassed; this hits
   * the DB on every call (intended for admin dashboards, not hot paths).
   */
  async getAll(): Promise<AllConfigs<R> & Record<string, any>> {
    const rows = await this.db.select().from(this.configs);
    const out: any = {};
    for (const row of rows) {
      const schema = this.registry[row.key];
      if (!schema) { out[row.key] = row.value; continue; }
      const validated = await validate(schema, row.value);
      out[row.key] = validated.issues ? await defaultFor(schema) : validated.value;
    }
    // Fill in registered keys that have no row yet, via schema defaults.
    for (const key of Object.keys(this.registry)) {
      if (key in out) { continue; }
      const dflt = await defaultFor(this.registry[key]);
      if (dflt !== undefined) { out[key] = dflt; }
    }
    return out;
  }

  /**
   * Remove a key from the DB. Drops the cache entry, notifies local
   * subscribers (with the schema default, when registered), and
   * publishes the invalidation to other instances.
   */
  async delete(key: string): Promise<boolean> {
    const result = await this.db.delete(this.configs).where(eq(this.configs.key, key));
    this.cache.delete(key);

    const schema = this.registry[key];
    const newValue = schema ? await defaultFor(schema) : null;
    this.#notify(key, newValue);

    if (this.presence) {
      await this.presence.publish(this.channel, { key, value: newValue });
    }
    return affectedRows(result) > 0;
  }

  /**
   * Disconnect from Presence and drop all listeners/cache. Called by
   * `GameDatabase.shutdown()`.
   */
  async shutdown(): Promise<void> {
    if (this.presence && this.presenceCallback) {
      await this.presence.unsubscribe(this.channel, this.presenceCallback);
      this.presenceCallback = undefined;
    }
    this.listeners.clear();
    this.cache.clear();
  }

  // ---- private --------------------------------------------------------

  #handleInvalidation(msg: InvalidationMessage): void {
    if (!msg || typeof msg.key !== 'string') { return; }
    this.cache.set(msg.key, msg.value);
    this.#notify(msg.key, msg.value);
  }

  #notify(key: string, value: any): void {
    const subs = this.listeners.get(key);
    if (!subs) { return; }
    for (const cb of subs) { cb(value); }
  }
}

// -----------------------------------------------------------------------
// Internal: standard-schema validation helpers
// -----------------------------------------------------------------------

/**
 * Pass-through wrapper around `StandardSchemaV1.validate` that always
 * resolves the promise. The returned shape matches the spec — `value`
 * on success, `issues` on failure — so callers narrow with the
 * `'issues' in result` check (works under both `strict` and
 * `strict: false` builds; `if (!result.ok)`-style narrowing on a
 * discriminated union doesn't survive `strictNullChecks: false`).
 */
type ValidateResult<T> =
  | { value: T; issues?: undefined }
  | { value?: undefined; issues: readonly StandardSchemaV1.Issue[] };

async function validate<S extends StandardSchemaV1>(
  schema: S,
  input: unknown,
): Promise<ValidateResult<StandardSchemaV1.InferOutput<S>>> {
  const r = schema['~standard'].validate(input);
  return (r instanceof Promise ? await r : r) as ValidateResult<StandardSchemaV1.InferOutput<S>>;
}

/** Resolve a schema's default by validating `undefined`. */
async function defaultFor(schema: StandardSchemaV1): Promise<any> {
  const r = await validate(schema, undefined);
  return r.issues ? undefined : r.value;
}
