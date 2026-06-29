import { now } from './core/utils.ts';

/**
 * Contract the {@link Room} expects from its clock. The default is
 * {@link RoomClock}; consumers can replace `room.clock` with any object
 * satisfying this interface (test mocks, alternative RTT estimators,
 * NTP-style probe-driven clocks, etc.).
 *
 * PURE TIME + LATENCY: the clock no longer tracks input acks. The input
 * round-trip (what you sent / what the server processed) lives on the
 * {@link InputHandle}; the Room feeds the clock a pre-computed RTT sample.
 */
export interface RoomClockLike {
    /** Local monotonic clock (ms) — the un-offset base {@link serverNow} is built on.
     *  For SELF-IMPOSED relative gates (a cooldown / fire-rate you started locally):
     *  `now() - lastAction >= COOLDOWN_MS`. A relative measure cancels the clock offset,
     *  so this needs no clock sync and dodges the offset-EMA jitter. Contrast
     *  {@link serverNow}, which you want for server-STAMPED absolute deadlines
     *  (invuln / respawn / buy-phase windows you compare an absolute instant against). */
    now(): number;
    /** Estimated server clock (ms since room start — see {@link RoomClock.serverNow}). */
    serverNow(): number;
    /** Last RTT sample (ms). */
    rtt(): number;
    /** EMA-smoothed RTT (ms). Preferred for forward-prediction. */
    smoothedRtt(): number;
    /** Connection *jitter* (ms): RFC 3550-style interarrival jitter — an EMA of how far
     *  each patch's arrival interval strays from the advertised cadence. A connection-
     *  quality signal (~0 on a steady link), independent of the latency level. A custom
     *  clock with no patch cadence can return `0`. `0` until the cadence is known and two patches land. */
    jitter(): number;
    /** Server-encode time (ms since room start) of the MOST RECENT patch — the
     *  raw `sNow` of the last TIMED sample, NOT offset-reconstructed. The state
     *  you currently hold represents the server at this instant, so
     *  `serverNow() − lastServerTime()` is the snapshot's age — the exact
     *  forward horizon for dead-reckoning a remote entity to "now". `0` until
     *  the first sample. */
    lastServerTime(): number;
    /** Server snapshot cadence (`patchRate`, ms) — the interval at which the
     *  server broadcasts state, advertised in the input handshake. On the
     *  jitter-free server-time axis a MOVING field gets a sample every patch, so
     *  interpolation uses this to tell a delta-encoded IDLE gap (collapse it)
     *  from the normal cadence. `0` when unknown (no input room / not advertised). */
    patchInterval?(): number;
    /** Feed the server's snapshot cadence (`patchRate`, ms), decoded once from
     *  the input handshake — the producer side of {@link patchInterval}, and a
     *  Room→clock feed like {@link sample}. Optional: a custom clock that doesn't
     *  drive interpolation idle-gap detection need not implement it. */
    setPatchInterval?(milliseconds: number): void;
    /** Feed a decoded TIMED sample: `sNow` (ms since room start) updates the
     *  clock offset; `rttSample` (ms round-trip from the input ack, or `<0` if
     *  none this packet) updates the RTT estimate. */
    sample(sNow: number, rttSample: number): void;
}

/**
 * Stub clock returned by {@link Room.clock} until the JOIN_ROOM handshake
 * reveals whether the room declared input.
 *
 * - `serverNow()` falls back to the client's own `performance.now()` — a
 *   monotonic, non-offset-corrected timestamp. Good enough for any consumer
 *   that just wants "a monotonic ms reading."
 * - `rtt()` / `smoothedRtt()` return `0` (no samples available).
 * - `sample()` is a no-op.
 *
 * Shared, frozen singleton — costs nothing to keep around for rooms that
 * never call `defineInput()`. The Room replaces it with a real
 * {@link RoomClock} during handshake when input is declared.
 */
export const NULL_CLOCK: RoomClockLike = Object.freeze({
    now: () => now(),
    serverNow: () => now(),
    rtt: () => 0,
    smoothedRtt: () => 0,
    jitter: () => 0,
    lastServerTime: () => 0,
    patchInterval: () => 0,
    setPatchInterval: (_ms?: number) => { /* no-op */ },
    sample: (_sNow?: number, _rttSample?: number) => { /* no-op */ },
});

/**
 * Per-room clock-sync + RTT estimator, fed by the {@link ProtocolModifier.TIMED}
 * prefix the server prepends to state messages when the room declared input
 * via `defineInput()`.
 *
 * Two independent estimates are tracked:
 *
 * - **Clock offset** (`serverNow()`): the delta between server `performance.now()`
 *   and the client's. Seeded by the first sample (offset-only or RTT-valid)
 *   then EMA-smoothed. Used so client-side comparisons against
 *   server-stamped deadlines (`invulnUntil`, `hitTime`, etc.) line up.
 *
 * - **Round-trip time** (`rtt()` / `smoothedRtt()`): computed by correlating
 *   the server-echoed `lastInputSeq` with the client's own send-time table.
 *   Seeded *only* by the first RTT-valid sample (separate from the offset
 *   seed) — otherwise the first valid sample would EMA-blend from 0 and
 *   strand the smoothed value at ~10% of reality, after which the outlier
 *   guard would reject every subsequent real sample.
 *
 * Doesn't know about transports, schemas, input, or Room internals — the Room
 * calls {@link sample} when a TIMED prefix arrives, passing a pre-computed RTT
 * sample (the input round-trip is tracked by the InputHandle). Pure math.
 */
export class RoomClock implements RoomClockLike {
    /** Default exponential-smoothing weight for offset + RTT EMA. */
    private static readonly EMA_ALPHA = 0.1;

    /**
     * RTT samples greater than `outlierFactor × smoothedRtt` are rejected.
     * Catches tab-resume spikes once the smoothed value has converged; the
     * separate `_rttHasSample` seed prevents this from clamping early
     * legitimate samples to a stranded baseline.
     */
    private static readonly RTT_OUTLIER_X = 4;

    /** RFC 3550 jitter EMA gain (1/16) — slower than the RTT/offset EMA so the
     *  reported jitter is a steady readout rather than a per-patch flicker. */
    private static readonly JITTER_GAIN = 1 / 16;
    /** Arrival gaps beyond `JITTER_STALL_X ×` the cadence (a tab-resume stall), and
     *  sub-cadence bursts (mult 0), are skipped so they don't spike the jitter EMA. */
    private static readonly JITTER_STALL_X = 4;

    /**
     * Clock-offset jitter gate. An offset sample is only folded into the EMA when
     * its RTT is within `RTT_GATE_FACTOR ×` the windowed-minimum RTT — i.e. the
     * packet traversed near-empty queues, so its `rtt/2` one-way estimate (and
     * thus the offset) is least corrupted by jitter. Higher-RTT samples carry
     * proportionally more jitter and are dropped (the offset just holds). This is
     * the NTP/QUIC pattern: EMA-smooth the value you report, but filter the input
     * by the low-delay floor — purely a VARIANCE reduction on `serverNow()`, which
     * is what steadies the stamped reckonTime. The held offset's small bias is
     * harmless (it cancels: predict + rewind share the stamped instant).
     */
    private static readonly RTT_GATE_FACTOR = 1.2;
    /** Sliding window (ms) over which the RTT floor (gate reference) is tracked.
     *  Long enough to hold a good low-jitter sample; on a route change the stale
     *  floor expires within this horizon and the gate re-opens. */
    private static readonly RTT_GATE_WINDOW = 10_000;
    /** Post-reset warmup: the first `RTT_GATE_WARMUP` RTT-valid samples BYPASS the
     *  gate (pure EMA), so the offset converges at baseline speed after a reset /
     *  reconnect. The gate drops samples, which otherwise stretches convergence —
     *  worst at high RTT, where it showed as an inflated offset.std until settled.
     *  ~3× the EMA time-constant (1/α = 10) ⇒ converged before the gate engages for
     *  steady-state variance reduction. `0` disables the warmup (gate from sample 1). */
    private static readonly RTT_GATE_WARMUP = 30;

    private _clockOffset = 0;       // serverTime - clientTime at sample time
    private _clockHasSample = false;
    private _offsetCount = 0;       // RTT-valid offset samples since reset (gate warmup)

    // Sliding-window-minimum of RTT (monotonic deque: values increasing front→back,
    // front = windowed min). Parallel number arrays → no per-sample object alloc.
    private _rttFloorT: number[] = []; // sample arrival times (tNow), aligned with _rttFloorV
    private _rttFloorV: number[] = []; // RTT values, monotonically increasing

    private _rtt = 0;               // most recent RTT sample (ms)
    private _smoothedRtt = 0;       // EMA over RTT samples
    private _rttHasSample = false;

    private _jitter = 0;            // EMA of patch-arrival deviation from the cadence (ms)
    private _lastRecvTime = -1;     // arrival time of the previous patch; -1 until the first

    private _lastServerTime = 0;    // raw sNow of the last patch (snapshot stamp)
    private _patchInterval = 0;     // server patchRate (ms); 0 until advertised

    /** Estimated server clock: **milliseconds since room start** (the server's
     *  `clock.elapsedTime`, reconstructed via the wire `sNow` + local offset).
     *  NOT raw `performance.now()` — a portable integer-ms timeline the server's
     *  own time-keyed logic shares, so client-side reckon stays in phase.
     *  Returns the local clock until the first sample lands. */
    public serverNow(): number {
        return now() + this._clockOffset;
    }

    /** Local monotonic clock (ms): the client's own reading WITHOUT the server
     *  offset — the base {@link serverNow} adds the offset to. Use it for
     *  self-imposed relative cooldowns (`now() - lastAction >= COOLDOWN_MS`): they
     *  need only a steady rate, not clock sync, so this avoids the offset-EMA
     *  jitter `serverNow()` carries. @see RoomClockLike.now */
    public now(): number {
        return now();
    }

    /** Most recent RTT sample (ms). `0` until the first RTT-valid sample lands. */
    public rtt(): number {
        return this._rtt;
    }

    /** EMA-smoothed RTT (ms). `0` until the first RTT-valid sample lands. Prefer this for forward-prediction. */
    public smoothedRtt(): number {
        return this._smoothedRtt;
    }

    /** Connection jitter (ms): RFC 3550-style interarrival jitter — see
     *  {@link RoomClockLike.jitter}. `0` until the cadence is known and two patches land. */
    public jitter(): number {
        return this._jitter;
    }

    /** Server-encode time (raw `sNow`) of the most recent patch. Pair with
     *  {@link serverNow} for the snapshot age (`serverNow() − lastServerTime()`).
     *  `0` until the first sample. */
    public lastServerTime(): number {
        return this._lastServerTime;
    }

    /** Server snapshot cadence (`patchRate`, ms); `0` until the handshake
     *  advertises it. @see RoomClockLike.patchInterval */
    public patchInterval(): number {
        return this._patchInterval;
    }

    /** Set the server snapshot cadence (ms), from the input handshake's
     *  advertised `patchRate`. Non-positive values clear it back to `0`. */
    public setPatchInterval(milliseconds: number): void {
        this._patchInterval = milliseconds > 0 ? milliseconds : 0;
    }

    /**
     * Feed a decoded TIMED sample. The input round-trip lives on the
     * {@link InputHandle} now — the Room hands us a pre-computed RTT sample.
     *
     * @param sNow       Server clock (ms since room start, `clock.elapsedTime`)
     *                   → clock offset.
     * @param rttSample  Round-trip time (ms) for the input ack this packet
     *                   carried, or `< 0` if none (no matching send / no input
     *                   yet). Filtered + EMA-smoothed here.
     */
    public sample(sNow: number, rttSample: number): void {
        const tNow = now();
        const a = RoomClock.EMA_ALPHA;

        // Connection jitter (RFC 3550 interarrival): how far this patch's arrival
        // interval strays from the advertised cadence — measured against the cadence,
        // NOT `sNow` (only refreshed at the sim-tick rate, so a sim/patch rate mismatch
        // would beat in as phantom jitter). Idle/dropped patches round to a whole
        // multiple; bursts (mult 0) and stalls (> X) are skipped.
        const PI = this._patchInterval;
        if (this._lastRecvTime >= 0 && PI > 0) {
            const gap = tNow - this._lastRecvTime;
            const mult = Math.round(gap / PI);
            if (mult >= 1 && mult <= RoomClock.JITTER_STALL_X) {
                this._jitter += (Math.abs(gap - mult * PI) - this._jitter) * RoomClock.JITTER_GAIN;
            }
        }
        this._lastRecvTime = tNow;

        // Stamp the snapshot's server-encode time (raw, un-reconstructed).
        this._lastServerTime = sNow;

        // Reject impossible / outlier RTT (tab-resume spikes once converged).
        if (rttSample < 0) {
            rttSample = -1;
        } else if (this._smoothedRtt > 0 && rttSample > this._smoothedRtt * RoomClock.RTT_OUTLIER_X) {
            rttSample = -1;
        }

        // Clock offset: refreshed every patch (sNow advances each patch). Prefer
        // the RTT-corrected estimate when a fresh sample exists, else OWL-biased.
        const offsetSample = rttSample >= 0 ? sNow + rttSample / 2 - tNow : sNow - tNow;
        if (!this._clockHasSample) {
            this._clockOffset = offsetSample;
            this._clockHasSample = true;
            if (rttSample >= 0) { this.pushRttFloor(rttSample, tNow); this._offsetCount = 1; }
        } else if (rttSample >= 0) {
            // Track the windowed-min RTT and gate: only low-jitter samples update the
            // offset (see RTT_GATE_FACTOR) — EXCEPT during the post-reset warmup, when
            // the gate is bypassed so convergence isn't stretched (see RTT_GATE_WARMUP).
            // rttSample<0 (no ack this packet) skips the offset entirely — an
            // uncorrected `sNow-tNow` is the noisiest kind, so let the offset hold.
            const floor = this.pushRttFloor(rttSample, tNow);
            const warming = this._offsetCount < RoomClock.RTT_GATE_WARMUP;
            this._offsetCount++;
            if (warming || rttSample <= floor * RoomClock.RTT_GATE_FACTOR) {
                this._clockOffset = this._clockOffset * (1 - a) + offsetSample * a;
            }
        }

        // RTT: seeded on the first valid sample (separate flag — see class doc).
        if (rttSample >= 0) {
            this._rtt = rttSample;
            if (!this._rttHasSample) {
                this._smoothedRtt = rttSample;
                this._rttHasSample = true;
            } else {
                this._smoothedRtt = this._smoothedRtt * (1 - a) + rttSample * a;
            }
        }
    }

    /**
     * Push an RTT sample into the sliding-window-minimum deque and return the
     * current windowed-min RTT (the jitter-free floor the offset gate references).
     * Standard monotonic-deque algorithm — O(1) amortized, the deque holds only
     * descending "record-low" candidates (typically 1–few entries).
     */
    private pushRttFloor(rttSample: number, tNow: number): number {
        const T = this._rttFloorT, V = this._rttFloorV;
        // Drop back entries no lower than this sample — they can never be the min
        // again while this newer, ≤ sample is in the window.
        while (V.length > 0 && V[V.length - 1] >= rttSample) { V.pop(); T.pop(); }
        V.push(rttSample); T.push(tNow);
        // Expire entries older than the window from the front.
        const cutoff = tNow - RoomClock.RTT_GATE_WINDOW;
        while (T.length > 0 && T[0] < cutoff) { T.shift(); V.shift(); }
        return V[0]; // front = windowed minimum
    }

    /** Reset all state. Useful on reconnect when the room rebuilds context. */
    public reset(): void {
        this._clockOffset = 0;
        this._clockHasSample = false;
        this._offsetCount = 0;
        this._rtt = 0;
        this._smoothedRtt = 0;
        this._rttHasSample = false;
        this._jitter = 0;
        this._lastRecvTime = -1;
        this._lastServerTime = 0;
        this._rttFloorT.length = 0;
        this._rttFloorV.length = 0;
    }
}
