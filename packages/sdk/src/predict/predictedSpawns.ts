/**
 * Predicted-spawn store — optimistic, server-reconciled *entities* (a fired
 * bullet, a thrown grenade, a dropped item), the entity-level counterpart to
 * {@link PredictedEvents}' discrete keys.
 *
 * The pattern the shooter hand-rolls today:
 *
 *   - On fire, render a client-only bullet immediately (no ~RTT wait).
 *   - Skip rendering the server's copy of *my own* bullets (`if (ownerId ===
 *     me) continue`) to avoid a duplicate.
 *   - Never reconcile predicted → authoritative, because the server assigns
 *     the id and the client can't correlate them.
 *   - Hand-write mispredict cleanup ("server rejected the shot → ghost").
 *
 * `PredictedSpawns` collapses all of that. Predicted locals live **outside**
 * the schema collection (in this store); the authoritative entities stay in
 * the decoder-owned collection. Correlation happens *post-decode* — when the
 * server entity's `onAdd` fires, its fields are populated, so a pending local
 * is matched to it ({@link PredictedSpawnsOptions.correlate}) and the two
 * collapse onto one logical {@link SpawnEntry} with a **stable `id`**.
 *
 * The handoff is seamless not by sharing a JS object (that would need a
 * `@colyseus/schema` change) but by keeping `id` constant across the
 * predicted → authoritative transition: the renderer keys its sprite on
 * `entry.id` and reads `entry.server ?? entry.local`, so the predicted bullet
 * becomes the authoritative one with no remove/re-add churn. This is the one
 * contract the render loop must follow.
 *
 * Lifecycle:
 *   1. {@link spawn} — push an optimistic local; renders instantly.
 *   2. `onAdd` (mine + matched) — server confirms; same `id`, `server` set.
 *   3. {@link prune} — a local with no match within TTL was a mispredict
 *      (server rejected the action); drop it, the sprite reverts.
 *   4. `onRemove` — the authoritative entity despawned; drop the entry.
 *
 * Driven automatically when created via `predict.spawns(...)` — the owning
 * {@link Predict} ticks ({@link tick}, dead-reckons pending locals) and prunes
 * ({@link prune}) it each frame. For standalone use, call {@link attach} with a
 * subscribe function and drive `tick`/`prune` yourself.
 */
import { DEFAULT_TTL_POLICY } from "./predictedEvents.ts";

/**
 * Minimal clock shape consumed by the store — a strict subset of
 * `RoomClockLike`, declared locally so this module stays portable without an
 * intra-package dependency on `../RoomClock.ts`.
 */
export interface PredictedSpawnsClock {
    /** Lag-invariant timestamp source for spawn `at` and TTL comparison. */
    serverNow(): number;
    /** Current smoothed round-trip time, fed to the dynamic TTL policy. */
    smoothedRtt(): number;
}

/**
 * How a candidate server entity is paired to a pending local prediction:
 *   - `"fifo"` (default): consume the oldest unmatched prediction. Zero server
 *     cooperation; relies only on spawn order. Fragile only if the server
 *     rejects this client's actions *out of order*.
 *   - predicate: match the first pending local for which it returns true —
 *     e.g. `(local, server) => Math.abs(server.spawnTime - local.spawnTime) <
 *     TOL`. Robust to out-of-order without any extra wire field.
 */
export type SpawnCorrelation<S, L> = "fifo" | ((local: L, server: S) => boolean);

/** Options for {@link PredictedSpawns}. `S` is the server element type; `L` the
 *  predicted-local shape (defaults to `Partial<S>` — annotate a callback param
 *  or pass `L` explicitly to model client-only fields). */
export interface PredictedSpawnsOptions<S = unknown, L = Partial<S>, D = undefined> {
    /**
     * Which incoming server entities are this client's to correlate. Entities
     * for which this returns false are surfaced as *foreign* (server-only)
     * entries and never consume a prediction — e.g. `s => s.ownerId ===
     * room.sessionId`. Omit to treat every server entity as correlatable
     * (single-owner rooms).
     */
    owned?: (server: S) => boolean;

    /** Pairing strategy. Defaults to `"fifo"`. */
    correlate?: SpawnCorrelation<S, L>;

    /**
     * Advance a *pending* (not-yet-confirmed) local each frame. `dt` is seconds
     * since the previous {@link tick}. Confirmed entries read from the server
     * entity and are never stepped.
     */
    step?: (local: L, dt: number) => void;

    /**
     * Eviction window for unmatched predictions, in ms, given the current RTT.
     * A pending local older than this with no server match is a mispredict
     * (server rejected the action) and is dropped on {@link prune}. Defaults to
     * {@link DEFAULT_TTL_POLICY} — `max(2 × rtt, 600ms)`.
     */
    ttl?: (rtt: number) => number;

    /** Invoked when a prediction is dropped as a mispredict (TTL expiry). */
    onReject?: (local: L, id: number) => void;

    /**
     * Per-entry render-scratch factory. Called once when each logical entry is
     * created — both predicted spawns and foreign/server-native adds. The
     * returned object is exposed as `entry.data` and dropped automatically when
     * the entry dies (handoff preserves it; remove/prune/cancel discard it).
     *
     * Lets the render layer keep id-keyed scratch — a catch-up accumulator, a
     * hit/hidden latch — on a *server-owned* entry without a side map (you can
     * hang fields on your own `entry.local`, but not on the decoder's
     * `entry.server`, which can be recycled on remove/re-add). `D` is inferred
     * from the return type; omit it and `entry.data` is `undefined`.
     */
    data?: () => D;
}

/**
 * A merged logical entity. Exactly one per logical spawn, regardless of
 * predicted/authoritative status. Render via `server ?? local`, keyed on `id`.
 */
export interface SpawnEntry<S = unknown, L = Partial<S>, D = undefined> {
    /** Stable across the predicted → authoritative handoff. Key sprites on it. */
    readonly id: number;
    /** Authoritative instance; set once correlated (and for foreign entities). */
    server?: S;
    /** Predicted local; present until pruned or (for foreign entries) absent. */
    local?: L;
    /** `"pending"` = local only; `"confirmed"` = authoritative entity present. */
    readonly state: "pending" | "confirmed";
    /** Per-entry render scratch from {@link PredictedSpawnsOptions.data}; the
     *  reference is stable for the entry's life (mutate its fields freely) and
     *  dropped with the entry. `undefined` when no `data` factory was given. */
    readonly data: D;
}

/** Handle returned by {@link PredictedSpawns.spawn}. */
export interface SpawnHandle<L = unknown, D = undefined> {
    /** The logical id assigned to this prediction (survives handoff). */
    readonly id: number;
    /** The predicted local instance. */
    readonly local: L;
    /** This entry's render scratch (same object as `entry.data`). */
    readonly data: D;
    /** Drop this prediction (e.g. a local cancel or rollback). No-op once the entry
     *  has been confirmed by its authoritative `onAdd`, so a late/duplicate rollback
     *  can't nuke a legitimate entity. */
    cancel(): void;
    /** Mark the prediction accepted: exempt the still-pending entry from TTL
     *  eviction (its authoritative patch may land a tick after the confirmation). */
    accept(): void;
}

/** Internal entry — the live object reused across handoff. Carries `at` for
 *  TTL bookkeeping in addition to the public {@link SpawnEntry} fields. */
interface InternalEntry<S, L, D> {
    id: number;
    server: S | undefined;
    local: L | undefined;
    state: "pending" | "confirmed";
    /** Spawn time (`serverNow`) — undefined for entries with no prediction. */
    at: number | undefined;
    /** Set by `accept()` — a confirmed-but-slow spawn exempt from TTL eviction
     *  while its authoritative `onAdd` is still in flight. */
    accepted: boolean;
    data: D;
}

export class PredictedSpawns<S = unknown, L = Partial<S>, D = undefined> {
    private opts: PredictedSpawnsOptions<S, L, D>;
    private clock: PredictedSpawnsClock | null;
    private correlate: SpawnCorrelation<S, L>;
    private ttl: (rtt: number) => number;

    /** Master index: every live entry (pending + confirmed + foreign), in
     *  insertion order — FIFO correlation walks this picking the oldest
     *  still-`pending` entry. */
    private byId = new Map<number, InternalEntry<S, L, D>>();
    /** Secondary index: authoritative instance → entry, for `onRemove`. */
    private byServer = new Map<S, InternalEntry<S, L, D>>();

    private nextId = 1;
    private lastTickAt: number | undefined;
    private detach: (() => void) | undefined;

    /** Set by {@link dispose}; the owning Predict drops a `dead` child on its
     *  next tick. */
    dead = false;

    constructor(opts: PredictedSpawnsOptions<S, L, D> = {}, clock: PredictedSpawnsClock | null = null) {
        this.opts = opts;
        this.clock = clock;
        this.correlate = opts.correlate ?? "fifo";
        this.ttl = opts.ttl ?? DEFAULT_TTL_POLICY;
    }

    /**
     * Wire the store to a collection's add/remove stream. `subscribe` receives
     * the store's handlers and returns a detacher. Called once by
     * `predict.spawns(...)`; call it yourself for standalone use, e.g.
     *
     * ```ts
     * const cb = Callbacks.get(room);
     * spawns.attach((onAdd, onRemove) => {
     *   const a = cb.onAdd("bullets", onAdd);
     *   const r = cb.onRemove("bullets", onRemove);
     *   return () => { a?.(); r?.(); };
     * });
     * ```
     */
    attach(
        subscribe: (
            onAdd: (server: S, key: string | number) => void,
            onRemove: (server: S, key: string | number) => void,
        ) => () => void,
    ): void {
        this.detach?.();
        this.detach = subscribe(this.handleAdd, this.handleRemove);
    }

    /** Record an optimistic local spawn. Returns a handle for cancellation. */
    spawn(local: L): SpawnHandle<L, D> {
        const id = this.nextId++;
        const data = this.makeData();
        const entry: InternalEntry<S, L, D> = { id, server: undefined, local, state: "pending", at: this.now(), accepted: false, data };
        this.byId.set(id, entry);
        return {
            id,
            local,
            data,
            // Pending-safe: a confirmed entry is owned by the authoritative entity,
            // so a late rollback must not delete it.
            cancel: () => {
                const e = this.byId.get(id);
                if (e && e.state === "pending") { this.byId.delete(id); }
            },
            accept: () => {
                const e = this.byId.get(id);
                if (e) { e.accepted = true; }
            },
        };
    }

    private handleAdd = (server: S, _key: string | number): void => {
        // Decoder may re-fire for an instance already tracked (immediate replay
        // + a later op); ignore the second sighting.
        if (this.byServer.has(server)) { return; }

        // fifo / predicate match, or a foreign (server-only) entity.
        const matched = this.isOwned(server) ? this.takeMatch(server) : undefined;
        if (matched) {
            this.confirmEntry(matched, server);
        } else {
            // Foreign entity, or mine-without-a-prediction (joined late / the
            // server spawned it on my behalf) — surfaced as server-only.
            const entry: InternalEntry<S, L, D> = { id: this.nextId++, server, local: undefined, state: "confirmed", at: undefined, accepted: false, data: this.makeData() };
            this.byId.set(entry.id, entry);
            this.byServer.set(server, entry);
        }
    };

    /** Transition a matched pending entry to confirmed in place (the live object
     *  is reused across handoff — same `id`). */
    private confirmEntry(entry: InternalEntry<S, L, D>, server: S): void {
        entry.server = server;
        entry.state = "confirmed";
        this.byServer.set(server, entry);
    }

    private handleRemove = (server: S, _key: string | number): void => {
        const entry = this.byServer.get(server);
        if (entry) {
            this.byServer.delete(server);
            this.byId.delete(entry.id);
        }
    };

    /** Find a pending local to pair with `server`, per the correlation
     *  strategy. The matched entry transitions in place (not removed). */
    private takeMatch(server: S): InternalEntry<S, L, D> | undefined {
        const corr = this.correlate;
        // "fifo": claim the oldest pending.
        if (typeof corr !== "function") {
            for (const entry of this.byId.values()) {
                if (entry.state === "pending") { return entry; } // oldest pending
            }
            return undefined;
        }
        for (const entry of this.byId.values()) {
            if (entry.state === "pending" && corr(entry.local as L, server)) { return entry; }
        }
        return undefined;
    }

    private isOwned(server: S): boolean {
        return this.opts.owned ? this.opts.owned(server) : true;
    }

    private makeData(): D {
        return this.opts.data ? this.opts.data() : (undefined as D);
    }

    /**
     * Advance pending locals via {@link PredictedSpawnsOptions.step}. `now` is
     * the render clock (typically `performance.now()`); `dt` is derived in
     * seconds. Confirmed/foreign entries are left to the authoritative state.
     */
    tick(now: number = performance.now()): void {
        const step = this.opts.step;
        if (step !== undefined && this.lastTickAt !== undefined) {
            const dt = Math.max(0, (now - this.lastTickAt) / 1000);
            if (dt > 0) {
                for (const entry of this.byId.values()) {
                    if (entry.state === "pending") { step(entry.local as L, dt); }
                }
            }
        }
        this.lastTickAt = now;
    }

    /** Drop pending locals older than the TTL policy — mispredicts the server
     *  never confirmed. Uses `serverNow()` and the RTT-aware TTL. */
    prune(): void {
        if (this.byId.size === 0) { return; }
        const now = this.now();
        const ttl = this.ttl(this.clock?.smoothedRtt() ?? 0);
        for (const entry of this.byId.values()) {
            // `accepted` entries are server-confirmed and awaiting their (slightly
            // late) authoritative patch — never a mispredict, so skip eviction.
            if (entry.state === "pending" && !entry.accepted && entry.at !== undefined && now - entry.at > ttl) {
                this.byId.delete(entry.id);
                this.opts.onReject?.(entry.local as L, entry.id);
            }
        }
    }

    /** Iterate the merged view — exactly one entry per logical entity. */
    entries(): IterableIterator<SpawnEntry<S, L, D>> {
        return this.byId.values() as IterableIterator<SpawnEntry<S, L, D>>;
    }

    /** Is `id` still live this frame? Useful for despawning stale sprites. */
    alive(id: number): boolean {
        return this.byId.has(id);
    }

    /** Total live entries (pending + confirmed + foreign). */
    get size(): number {
        return this.byId.size;
    }

    /** Drop all predictions and tracked entries (keeps the subscription). */
    clear(): void {
        this.byId.clear();
        this.byServer.clear();
    }

    /** Detach from the collection, drop everything, and mark dead so the owning
     *  Predict stops driving it. */
    dispose(): void {
        this.dead = true;
        this.detach?.();
        this.detach = undefined;
        this.clear();
    }

    private now(): number {
        return this.clock?.serverNow() ?? performance.now();
    }
}
