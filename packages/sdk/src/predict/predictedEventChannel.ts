/**
 * Typed optimistic-event CHANNEL — the high-level face of {@link PredictedEvents}.
 *
 * A channel owns one logical event type end-to-end: **birth** in the predicted
 * simulation (`ctx.predict(channel, payload)` inside a rollback `step`, or
 * `channel.predict(payload)` outside the sim), **feedback** (`onPredict` fires
 * immediately — the optimistic celebration/sound/spawn), and **settlement**
 * against the server (below).
 *
 * Identity is the channel OBJECT — there is no registry key. Where the
 * low-level store keys entries by strings the app must keep in sync, a channel
 * is declared once, holds its typed callbacks, and every call site references
 * the binding. The optional {@link PredictedEventChannelOptions.label} is
 * debug metadata only; nothing resolves by it.
 *
 *     const goals = predict.defineEvent<Team>({
 *         onPredict: (team) => { celebrate(team); hidePuck(); },
 *         onReject:  ()     => showPuck(),
 *     });
 *
 *     // inside the reconciler step — live-only by construction, replay-safe:
 *     if (crossedGoalLine) ctx.predict(goals, scoredBy);
 *
 *     // settlement — the authoritative broadcast:
 *     room.onMessage("score", () => goals.confirm());
 *
 * SETTLEMENT — how a pending prediction resolves:
 *
 *   - **`confirm()`** — the app saw the authoritative signal (a broadcast, a
 *     state change): the prediction was right.
 *   - **Auto-reject (sim-born)** — the server's ack watermark passed the
 *     entry's birth seq by {@link PredictedEventChannelOptions.graceTicks}
 *     without a confirm. The server processed the very timeline that
 *     predicted the event and stayed silent — the event didn't happen. The
 *     confirm signal travels the same ordered socket as the acks, so a real
 *     event always confirms before this fires; no wall clock, no RTT
 *     estimate, no state polling. (Both obvious alternatives false-reject
 *     under latency: the predicted world flickers on reconciles, and
 *     authoritative state shows PRE-input history for ~RTT after predicting.)
 *   - **TTL (UI-born)** — entries with no sim timeline fall back to
 *     wall-clock eviction (`ttlMs`).
 *   - **`reject()` / `clear()`** — explicit app verdicts, any time.
 *
 * Settlement/timing semantics (TTL policy, serverNow clock, accepted-entry
 * exemption) are delegated to an internal {@link PredictedEvents} store — one
 * source of truth for both layers.
 */

import {
    PredictedEvents,
    DEFAULT_TTL_POLICY,
    type PredictedEventsClock,
} from "./predictedEvents.ts";
import { isReplaying, type PredictSink } from "./rollback.ts";

/** Entry key for non-primitive payloads when no
 *  {@link PredictedEventChannelOptions.uniqueBy} is given — the channel holds
 *  at most ONE pending prediction. */
const SINGLETON_KEY = 0;

/** Default {@link PredictedEventChannelOptions.graceTicks}: server progress
 *  past a prediction before an unconfirmed sim-born entry rejects (~333ms of
 *  simulation at 30Hz) — generous against contested-event divergence, and
 *  anchored to the ack stream so latency can't induce a false reject. */
export const DEFAULT_GRACE_TICKS = 10;

export interface PredictedEventChannelOptions<T> {
    /**
     * The optimistic feedback — fires the moment the event is predicted (from
     * the live sim step or `predict()`), ~RTT before the server could confirm.
     * Runs SYNCHRONOUSLY at the predicting call site; keep it light (play the
     * sound, set the flags, start the tween). A callback that needs a render
     * pose should take it from the payload rather than reading a game object
     * mid-step.
     *
     * OPTIONAL: flag-shaped consumers skip callbacks entirely and DERIVE from
     * the pending set instead — poll {@link PredictedEventChannel.has} each
     * frame, OR'd with authoritative state (`!enemy.alive || kills.has(id)`).
     * Mispredicts then recover implicitly: the entry settles, `has()` flips,
     * the derived view snaps back.
     */
    onPredict?: (payload: T) => void;
    /**
     * The prediction was wrong — undo the optimistic feedback (show the entity
     * again, refund the item). Fired by TTL expiry, explicit {@link reject},
     * or a {@link rejectWhen} contradiction. NOT fired by {@link confirm} or
     * {@link clear}.
     */
    onReject?: (payload: T) => void;
    /** The server agreed (fired by {@link confirm}, once per settled entry).
     *  Usually empty — the optimistic feedback already played. */
    onConfirm?: (payload: T) => void;
    /**
     * SIM-BORN settlement deadline, in input ticks: an entry auto-rejects
     * once the server has processed this many ticks PAST its birth seq
     * without a {@link PredictedEventChannel.confirm} — "the server ran the
     * predicted timeline and stayed silent". The slack absorbs client/server
     * divergence in WHEN the event lands (a contested crossing can occur a
     * few ticks later server-side than predicted); the confirm signal shares
     * the ordered socket with the acks, so a real event's confirm always
     * arrives well before this fires. Default {@link DEFAULT_GRACE_TICKS}.
     */
    graceTicks?: number;
    /**
     * Entry IDENTITY: two payloads mapping to the same value are "the same
     * event" — they dedupe while pending, and {@link confirm}/{@link reject}/
     * {@link has} take the value to address one entry among several.
     *
     * DEFAULT — pick by payload type:
     *   - a `string`/`number` payload IS its own identity (`(by) => by`):
     *     one pending entry per value — an enemy id, a hit category.
     *   - any other payload shares ONE anonymous pending slot (a goal, a
     *     death): while an entry is pending, further predictions are no-ops.
     *     (Keying objects by value isn't derivable — declare it.)
     *
     * Declare `uniqueBy` when an object payload carries presentation data
     * alongside its identity:
     *
     *     predict.defineEvent<{ projectileId: string; x: number; y: number }>({
     *         uniqueBy: (h) => h.projectileId,   // payload carries FX data; identity is the projectile
     *         onPredict: (h) => spawnImpactFx(h.x, h.y),
     *     });
     *
     * To force a single pending slot for a primitive payload: `uniqueBy: () => 0`.
     */
    uniqueBy?: (payload: T) => string | number;
    /**
     * Eviction window for unconfirmed UI-BORN predictions (`predict()` with
     * no sim timeline — nothing to anchor a deadline to but the wall clock).
     * Number for a static TTL; function of the current smoothed RTT for a
     * dynamic policy. Defaults to {@link DEFAULT_TTL_POLICY}
     * (`max(2 × rtt, 600ms)`). Sim-born entries are EXEMPT — they settle by
     * server progress (see {@link graceTicks}).
     */
    ttlMs?: number | ((rtt: number) => number);
    /**
     * Minimum gap (ms) between `onPredict` fires, channel-wide — predictions
     * arriving inside the window are dropped entirely (no entry, no feedback).
     * The optimistic mirror of a server-side broadcast cooldown: give it the
     * same value and predicted + confirmed feedback pair one-to-one.
     */
    cooldownMs?: number;
    /** Debug metadata (panel/telemetry display). Nothing resolves by it. */
    label?: string;
}

export class PredictedEventChannel<T> implements PredictSink<T> {
    private readonly opts: PredictedEventChannelOptions<T>;
    /** Settlement engine: TTL clock + accepted-exemption live here. */
    private readonly store: PredictedEvents<string | number>;
    /** Pending payloads by entry key (payload echoed to the settle callbacks).
     *  `acked` is the emitting controller's watermark (sim-born entries only). */
    private readonly entries = new Map<string | number, { payload: T; seq: number; acked?: () => number }>();
    private readonly now: () => number;
    private cooldownUntil = -Infinity;
    private warnedReplayPredict = false;

    constructor(opts: PredictedEventChannelOptions<T>, clock: PredictedEventsClock | null) {
        this.opts = opts;
        this.now = () => clock?.serverNow() ?? performance.now();
        this.store = PredictedEvents.get<string | number>({ clock }, {
            ttlMs: opts.ttlMs ?? DEFAULT_TTL_POLICY,
            // one internal rejection path — TTL prune and explicit reject() both land here
            onReject: (key) => {
                const e = this.entries.get(key);
                this.entries.delete(key);
                if (e) this.opts.onReject?.(e.payload);
            },
        });
    }

    /** Sim-born prediction — reached via `ctx.predict(channel, payload)`, which
     *  only forwards LIVE steps (replays are filtered before this is called). */
    _predictFromSim(seq: number, payload: T, acked?: () => number): void {
        this.add(seq, payload, acked);
    }

    /**
     * Predict from OUTSIDE the sim (a UI-optimistic action with no rollback
     * timeline). Inside a reconciler `step`, use `ctx.predict(channel, payload)`
     * instead — this form is backstopped (a call that lands inside a rollback
     * replay no-ops and warns once) but the ctx form is live-only by
     * construction.
     */
    predict(payload: T): void {
        if (isReplaying()) {
            if (!this.warnedReplayPredict) {
                this.warnedReplayPredict = true;
                console.warn(
                    `@colyseus/sdk: PredictedEventChannel${this.opts.label ? ` "${this.opts.label}"` : ""}` +
                    `.predict() was called during a rollback replay and ignored. ` +
                    `Inside a reconciler step, use ctx.predict(channel, payload).`,
                );
            }
            return;
        }
        this.add(-1, payload);
    }

    private add(seq: number, payload: T, acked?: () => number): void {
        // identity: uniqueBy > primitive payload keys itself > anonymous slot
        const key = this.opts.uniqueBy !== undefined
            ? this.opts.uniqueBy(payload)
            : (typeof payload === "string" || typeof payload === "number" ? payload : SINGLETON_KEY);
        if (this.entries.has(key)) return;   // already pending — re-derivations don't re-fire
        const t = this.now();
        if (this.opts.cooldownMs !== undefined) {
            if (t < this.cooldownUntil) return;
            this.cooldownUntil = t + this.opts.cooldownMs;
        }
        const handle = this.store.predict(key, t);
        // sim-born entries settle by server progress (see prune), not wall clock
        if (acked !== undefined) handle.accept();
        this.entries.set(key, { payload, seq, acked });
        this.opts.onPredict?.(payload);
    }

    /** Is a prediction pending? With `key`, that entry; without, any. */
    has(key?: string | number): boolean {
        return key === undefined ? this.entries.size > 0 : this.entries.has(key);
    }

    /** Number of pending (unsettled) predictions. */
    get pendingCount(): number { return this.entries.size; }

    /**
     * The server agreed: settle the entry for `key` — or EVERY pending entry
     * when omitted (the single-pending shape). Fires `onConfirm` per settled
     * entry; never `onReject`. Returns how many entries were settled — `0`
     * means the event arrived unpredicted (the caller usually plays the
     * feedback it skipped optimistically).
     */
    confirm(key?: string | number): number {
        let n = 0;
        for (const k of this.settleKeys(key)) {
            const e = this.entries.get(k);
            if (e === undefined) continue;
            this.entries.delete(k);
            this.store.confirm(k);    // silent drop — confirm never fires onReject
            this.opts.onConfirm?.(e.payload);
            n++;
        }
        return n;
    }

    /** The server overruled: reject the entry for `key` — or every pending
     *  entry when omitted. Fires `onReject` per entry. Returns the count. */
    reject(key?: string | number): number {
        let n = 0;
        for (const k of this.settleKeys(key)) {
            if (!this.entries.has(k)) continue;
            this.store.reject(k);     // internal wiring deletes the entry + fires onReject(payload)
            n++;
        }
        return n;
    }

    private settleKeys(key: string | number | undefined): (string | number)[] {
        return key !== undefined ? [key] : [...this.entries.keys()];
    }

    /** Drop every pending entry SILENTLY (no callbacks) — respawns, scene
     *  teardown, "this life's predictions no longer apply". */
    clear(): void {
        this.entries.clear();
        this.store.clear();
    }

    /** Per-frame drive (the owning Predict calls this from `tick()`):
     *  `rejectWhen` contradictions first, then TTL eviction. */
    prune(): void {
        if (this.entries.size > 0) {
            const grace = this.opts.graceTicks ?? DEFAULT_GRACE_TICKS;
            for (const [key, e] of [...this.entries]) {
                // sim-born auto-settle: the server processed `grace` ticks past
                // the prediction without confirming — the event didn't happen
                if (e.acked !== undefined && e.acked() >= e.seq + grace) this.store.reject(key);
            }
        }
        this.store.prune();   // wall-clock TTL — UI-born entries (sim-born are accept()ed)
    }

    /** Set by {@link dispose} — the owning Predict drops a dead channel from
     *  its drive list on the next tick. */
    dead = false;

    /** Stop being driven and drop all entries (silently). */
    dispose(): void {
        this.dead = true;
        this.clear();
        this.store.dispose();
    }
}
