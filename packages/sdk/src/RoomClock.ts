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
    /** Estimated server clock (ms since room start — see {@link RoomClock.serverNow}). */
    serverNow(): number;
    /** Last RTT sample (ms). */
    rtt(): number;
    /** EMA-smoothed RTT (ms). Preferred for forward-prediction. */
    smoothedRtt(): number;
    /** Server-encode time (ms since room start) of the MOST RECENT patch — the
     *  raw `sNow` of the last TIMED sample, NOT offset-reconstructed. The state
     *  you currently hold represents the server at this instant, so
     *  `serverNow() − lastServerTime()` is the snapshot's age — the exact
     *  forward horizon for dead-reckoning a remote entity to "now". `0` until
     *  the first sample. */
    lastServerTime(): number;
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
    serverNow: () => now(),
    rtt: () => 0,
    smoothedRtt: () => 0,
    lastServerTime: () => 0,
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

    private _clockOffset = 0;       // serverTime - clientTime at sample time
    private _clockHasSample = false;

    private _rtt = 0;               // most recent RTT sample (ms)
    private _smoothedRtt = 0;       // EMA over RTT samples
    private _rttHasSample = false;

    private _lastServerTime = 0;    // raw sNow of the last patch (snapshot stamp)

    /** Estimated server clock: **milliseconds since room start** (the server's
     *  `clock.elapsedTime`, reconstructed via the wire `sNow` + local offset).
     *  NOT raw `performance.now()` — a portable integer-ms timeline the server's
     *  own time-keyed logic shares, so client-side reckon stays in phase.
     *  Returns the local clock until the first sample lands. */
    public serverNow(): number {
        return now() + this._clockOffset;
    }

    /** Most recent RTT sample (ms). `0` until the first RTT-valid sample lands. */
    public rtt(): number {
        return this._rtt;
    }

    /** EMA-smoothed RTT (ms). `0` until the first RTT-valid sample lands. Prefer this for forward-prediction. */
    public smoothedRtt(): number {
        return this._smoothedRtt;
    }

    /** Server-encode time (raw `sNow`) of the most recent patch. Pair with
     *  {@link serverNow} for the snapshot age (`serverNow() − lastServerTime()`).
     *  `0` until the first sample. */
    public lastServerTime(): number {
        return this._lastServerTime;
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
        } else {
            this._clockOffset = this._clockOffset * (1 - a) + offsetSample * a;
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

    /** Reset all state. Useful on reconnect when the room rebuilds context. */
    public reset(): void {
        this._clockOffset = 0;
        this._clockHasSample = false;
        this._rtt = 0;
        this._smoothedRtt = 0;
        this._rttHasSample = false;
        this._lastServerTime = 0;
    }
}
