/**
 * Generic optimistic-prediction store with TTL-based mispredict cleanup.
 *
 * Pattern: the client predicts a discrete event happened (death, pickup,
 * door-open, projectile-spawn, …), marks the corresponding key. The render
 * layer reads the predicted state immediately rather than waiting ~RTT for
 * the server's authoritative confirmation. Two cleanup paths:
 *
 *   1. **Confirm** — caller observes the server's authoritative state change
 *      (e.g. via `Callbacks.listen(instance, "alive", …)`) and drops the
 *      entry: prediction was correct, schema is now the truth.
 *   2. **Prune** — each frame, entries older than `ttlMs` are dropped: the
 *      server didn't confirm within the window, so the prediction was wrong;
 *      the render reverts when the entry vanishes.
 *
 * Generic over the key type so callers can use string ids, schema instances
 * (via Map/WeakMap-compatible references), or composite tuples.
 *
 * Timing/TTL is injected via {@link configure}. Callers wire `now` (typically
 * `room.clock.serverNow`) and a `ttlMs` policy once at startup; subsequent
 * `predict()` / `prune()` calls can omit those args. Per-call args still
 * override the configured providers when you need explicit control (tests,
 * mixed clocks, etc.).
 */
export interface PredictedEventsConfig {
    /** Source of "now" timestamps for the `at` param of `predict()` and the
     *  comparison clock in `prune()`. Typically `() => room.clock.serverNow()`.
     *  Defaults to `performance.now()` when unset. */
    now?: () => number;
    /** Eviction window for `prune()`. Number for a static TTL; function for
     *  a dynamic policy (e.g. `() => Math.max(rtt * 2, 600)`). Re-evaluated
     *  each `prune()` call so RTT-derived policies stay current. */
    ttlMs?: number | (() => number);
    /** Invoked when a prediction is dropped as a mispredict — by {@link
     *  PredictedEvents.reject} (explicit) or by {@link PredictedEvents.prune}
     *  (TTL expiry). NOT fired by `confirm` (correct) or `cancel` (deliberate
     *  local undo). The render layer reads this to learn an event was undone. */
    onReject?: (key: any) => void;
}

/**
 * Minimal clock shape consumed by {@link PredictedEvents.get}. A strict
 * subset of `RoomClockLike` — declared locally so this module stays
 * portable without an intra-package dependency on `../RoomClock.ts`.
 */
export interface PredictedEventsClock {
    serverNow(): number;
    smoothedRtt(): number;
}

/**
 * Default TTL policy for {@link PredictedEvents.get}: `max(2 × smoothedRtt, 600ms)`.
 *
 *   - **2× RTT** absorbs round-trip + ordinary jitter — predictions that
 *     don't confirm within this window were almost certainly mispredicted.
 *   - **600 ms floor** guards against RTT being 0 (clock not bootstrapped)
 *     or pathologically small (loopback testing).
 *
 * Exported so callers can compose against it, e.g.
 * `ttlMs: rtt => Math.max(rtt * 1.5, DEFAULT_TTL_POLICY(rtt))`.
 */
export const DEFAULT_TTL_POLICY = (rtt: number): number => Math.max(rtt * 2, 600);

/** Options for the room-aware factory {@link PredictedEvents.get}. */
export interface PredictedEventsGetOptions<K = string> {
    /** Eviction window. Number for a static TTL; function receives the current
     *  RTT (from `room.clock.smoothedRtt()`) and returns the TTL in ms.
     *  Defaults to {@link DEFAULT_TTL_POLICY}. */
    ttlMs?: number | ((rtt: number) => number);
    /** See {@link PredictedEventsConfig.onReject}. */
    onReject?: (key: K) => void;
}

/**
 * Handle returned by {@link PredictedEvents.predict} — the discrete-event
 * counterpart to {@link import('./predictedSpawns.ts').SpawnHandle}. Lets a
 * caller roll back ({@link cancel}) or protect ({@link accept}) an optimistic
 * event, without tracking the key.
 */
export interface PredictedEventHandle<K = string> {
    /** The predicted key. */
    readonly key: K;
    /** Drop the prediction now (rollback). No `onReject` — a deliberate undo. */
    cancel(): void;
    /** Server-confirmed: keep the predicted effect but exempt it from TTL
     *  eviction. Await the authoritative schema change, then call {@link
     *  PredictedEvents.confirm}. */
    accept(): void;
}

export class PredictedEvents<K = string> {
    /**
     * Room-aware factory. Auto-binds `now()` to `room.clock.serverNow()` and
     * wires the optional dynamic-TTL policy with the room's `smoothedRtt()`.
     * Equivalent to `new PredictedEvents() + configure({...})` but one line.
     *
     * Defaults to {@link DEFAULT_TTL_POLICY} (`max(2 × rtt, 600ms)`) when
     * `opts.ttlMs` is omitted — suitable for most optimistic predictions.
     *
     * Use this when you can instantiate after the room is available. For
     * module-load-time declarations (when the room doesn't exist yet),
     * prefer `new PredictedEvents() + configure(...)` instead.
     */
    static get<K = string>(
        room: { clock?: PredictedEventsClock | null },
        opts: PredictedEventsGetOptions<K> = {},
    ): PredictedEvents<K> {
        const pe = new PredictedEvents<K>();
        pe.configure(buildClockConfig(room.clock ?? null, opts.ttlMs ?? DEFAULT_TTL_POLICY));
        if (opts.onReject) { pe.configure({ onReject: opts.onReject as (key: any) => void }); }
        return pe;
    }

    private entries = new Map<K, number>();
    /** Keys marked server-confirmed via a handle's `accept()` — exempt from TTL
     *  eviction while the authoritative schema change is still in flight. */
    private accepted = new Set<K>();
    private cfg: PredictedEventsConfig = {};

    /** Bind/override default providers for `predict()` and `prune()`. Call
     *  once after the room (and clock) is available; subsequent calls merge.
     *  Per-call args still take precedence over the configured providers. */
    configure(cfg: PredictedEventsConfig): void {
        this.cfg = { ...this.cfg, ...cfg };
    }

    /** Record an optimistic prediction. `at` defaults to the configured
     *  `now()` provider, falling back to `performance.now()`. Returns a handle to
     *  roll it back ({@link PredictedEventHandle.cancel}) or protect it
     *  ({@link PredictedEventHandle.accept}). */
    predict(key: K, at?: number): PredictedEventHandle<K> {
        this.entries.set(key, at ?? this.cfg.now?.() ?? performance.now());
        return {
            key,
            cancel: () => { this.entries.delete(key); this.accepted.delete(key); },
            accept: () => { if (this.entries.has(key)) { this.accepted.add(key); } },
        };
    }

    /** Is there an unconfirmed prediction for this key? */
    has(key: K): boolean {
        return this.entries.has(key);
    }

    /** The server confirmed the prediction (or the caller wants to drop it). */
    confirm(key: K): void {
        this.entries.delete(key);
        this.accepted.delete(key);
    }

    /** The server overruled this prediction — drop it now and fire `onReject`
     *  (immediate mispredict, vs `confirm`'s silent correct-prediction drop). */
    reject(key: K): void {
        if (this.entries.delete(key)) {
            this.accepted.delete(key);
            this.cfg.onReject?.(key);
        }
    }

    /** Drop entries older than `ttlMs` — they're mispredictions the server
     *  didn't agree with. `now` defaults to the configured `now()` provider;
     *  `ttlMs` defaults to the configured policy (number or function). */
    prune(now?: number, ttlMs?: number): void {
        const t = now ?? this.cfg.now?.() ?? performance.now();
        const policy = this.cfg.ttlMs;
        const ttl = ttlMs ?? (typeof policy === "function" ? policy() : policy) ?? Infinity;
        for (const [k, at] of this.entries) {
            if (this.accepted.has(k)) { continue; } // server-confirmed — exempt from TTL
            if (t - at > ttl) {
                this.entries.delete(k);
                this.cfg.onReject?.(k);
            }
        }
    }

    /** Drop everything. */
    clear(): void {
        this.entries.clear();
        this.accepted.clear();
    }

    get size(): number {
        return this.entries.size;
    }

    /** Set when {@link dispose} is called — a Predict that auto-prunes this
     *  store (via `predict.events()`) drops a `dead` child on its next tick. */
    dead = false;

    /** Stop being auto-pruned by the owning Predict and drop all entries. */
    dispose(): void {
        this.dead = true;
        this.entries.clear();
        this.accepted.clear();
    }
}

/** Encode the "RTT-aware TTL policy" semantics for the room-aware factory. */
function buildClockConfig(
    clock: PredictedEventsClock | null,
    ttlMs: PredictedEventsGetOptions["ttlMs"],
): PredictedEventsConfig {
    return {
        now: () => clock?.serverNow() ?? performance.now(),
        ttlMs: typeof ttlMs === "function"
            ? () => ttlMs(clock?.smoothedRtt() ?? 0)
            : ttlMs,
    };
}
