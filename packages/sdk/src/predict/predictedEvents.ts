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
export interface PredictedEventsGetOptions {
    /** Eviction window. Number for a static TTL; function receives the current
     *  RTT (from `room.clock.smoothedRtt()`) and returns the TTL in ms.
     *  Defaults to {@link DEFAULT_TTL_POLICY}. */
    ttlMs?: number | ((rtt: number) => number);
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
        opts: PredictedEventsGetOptions = {},
    ): PredictedEvents<K> {
        const pe = new PredictedEvents<K>();
        pe.configure(buildClockConfig(room.clock ?? null, opts.ttlMs ?? DEFAULT_TTL_POLICY));
        return pe;
    }

    private entries = new Map<K, number>();
    private cfg: PredictedEventsConfig = {};

    /** Bind/override default providers for `predict()` and `prune()`. Call
     *  once after the room (and clock) is available; subsequent calls merge.
     *  Per-call args still take precedence over the configured providers. */
    configure(cfg: PredictedEventsConfig): void {
        this.cfg = { ...this.cfg, ...cfg };
    }

    /** Record an optimistic prediction. `at` defaults to the configured
     *  `now()` provider, falling back to `performance.now()`. */
    predict(key: K, at?: number): void {
        this.entries.set(key, at ?? this.cfg.now?.() ?? performance.now());
    }

    /** Is there an unconfirmed prediction for this key? */
    has(key: K): boolean {
        return this.entries.has(key);
    }

    /** The server confirmed the prediction (or the caller wants to drop it). */
    confirm(key: K): void {
        this.entries.delete(key);
    }

    /** Drop entries older than `ttlMs` — they're mispredictions the server
     *  didn't agree with. `now` defaults to the configured `now()` provider;
     *  `ttlMs` defaults to the configured policy (number or function). */
    prune(now?: number, ttlMs?: number): void {
        const t = now ?? this.cfg.now?.() ?? performance.now();
        const policy = this.cfg.ttlMs;
        const ttl = ttlMs ?? (typeof policy === "function" ? policy() : policy) ?? Infinity;
        for (const [k, at] of this.entries) {
            if (t - at > ttl) this.entries.delete(k);
        }
    }

    /** Drop everything. */
    clear(): void {
        this.entries.clear();
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
