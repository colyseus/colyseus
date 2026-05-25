import { now } from './core/utils.ts';

/**
 * Contract the {@link Room} expects from its clock. The default is
 * {@link RoomClock}; consumers can replace `room.clock` with any object
 * satisfying this interface (test mocks, alternative RTT estimators,
 * NTP-style probe-driven clocks, etc.).
 *
 * The Room only calls these five methods — no other shape is implied.
 */
export interface RoomClockLike {
    /** Estimated server wall-clock (ms). */
    serverNow(): number;
    /** Last RTT sample (ms). */
    rtt(): number;
    /** EMA-smoothed RTT (ms). Preferred for forward-prediction. */
    smoothedRtt(): number;
    /** Feed a TIMED-prefix sample decoded off the wire. */
    sample(sNow: number, lastTReceived: number, lastInputSeq: number): void;
    /** Record a reliable input send — called by the InputHandle. */
    recordSend(): void;
}

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
 * Doesn't know about transports, schemas, or Room internals — the Room calls
 * {@link recordSend} on each reliable input send and {@link sample} when a
 * TIMED prefix arrives. Everything else is pure math.
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

    /** Cap on the send-time table. Older entries evict on overflow. */
    private static readonly SEND_TIME_TABLE_MAX = 256;

    private _clockOffset = 0;       // serverTime - clientTime at sample time
    private _clockHasSample = false;

    private _rtt = 0;               // most recent RTT sample (ms)
    private _smoothedRtt = 0;       // EMA over RTT samples
    private _rttHasSample = false;

    private _lastSampledInputSeq = 0;
    private _sentInputCount = 0;
    private _sentInputTimes = new Map<number, number>();

    /** Estimated server wall-clock (ms). Returns `performance.now()` until the first sample lands. */
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

    /**
     * Called by the InputHandle after each *reliable* input is sent. Bumps the
     * monotonic counter (mirrors the server's `client._receivedInputCount`)
     * and stamps the client's current time keyed by that counter — so the
     * next TIMED prefix echoing `lastInputSeq` can produce an RTT sample.
     *
     * Unreliable sends do not call this — the redundant ring pattern would
     * double-count and break the seq↔send-time correlation.
     */
    public recordSend(): void {
        const seq = ++this._sentInputCount;
        if (this._sentInputTimes.size >= RoomClock.SEND_TIME_TABLE_MAX) {
            const first = this._sentInputTimes.keys().next().value;
            if (first !== undefined) this._sentInputTimes.delete(first);
        }
        this._sentInputTimes.set(seq, now());
    }

    /**
     * Feed a decoded TIMED prefix into the estimators.
     *
     * @param sNow           Server's `performance.now()` at encode time.
     * @param lastTReceived  Server's `performance.now()` when it received the
     *                       most recent reliable input from this client. `0`
     *                       if no input has been received yet.
     * @param lastInputSeq   Server's `_receivedInputCount` snapshot — the
     *                       index into our send-time table.
     */
    public sample(sNow: number, lastTReceived: number, lastInputSeq: number): void {
        const tNow = now();

        // Dedupe consecutive samples for the same ack — no new info.
        if (lastInputSeq !== 0 && lastInputSeq === this._lastSampledInputSeq) {
            return;
        }

        const sentAt = lastInputSeq !== 0
            ? this._sentInputTimes.get(lastInputSeq)
            : undefined;

        let rttSample = -1;
        if (sentAt !== undefined) {
            // Subtract server-side processing time (sNow - lastTReceived,
            // both in server clock) from observed round-trip
            // (tNow - sentAt, in client clock). Yields network-only RTT.
            const serverProcessing = Math.max(0, sNow - lastTReceived);
            rttSample = (tNow - sentAt) - serverProcessing;
            if (rttSample < 0) {
                rttSample = -1; // clock skew / impossible — ignore
            } else if (this._smoothedRtt > 0 && rttSample > this._smoothedRtt * RoomClock.RTT_OUTLIER_X) {
                rttSample = -1; // outlier — rejected
            }
        }

        // Offset estimate: prefer RTT-corrected when we have one, otherwise
        // fall back to OWL-biased `sNow - tNow`.
        const offsetSample = rttSample >= 0
            ? sNow + rttSample / 2 - tNow
            : sNow - tNow;

        const a = RoomClock.EMA_ALPHA;

        // Offset: seeded on first sample (offset-only or RTT-valid), EMA after.
        if (!this._clockHasSample) {
            this._clockOffset = offsetSample;
            this._clockHasSample = true;
        } else {
            this._clockOffset = this._clockOffset * (1 - a) + offsetSample * a;
        }

        // RTT: seeded on the first *RTT-valid* sample (separate flag — see
        // class doc). Otherwise the first valid sample EMA-blends from 0
        // and the outlier guard rejects every subsequent real sample.
        if (rttSample >= 0) {
            this._rtt = rttSample;
            if (!this._rttHasSample) {
                this._smoothedRtt = rttSample;
                this._rttHasSample = true;
            } else {
                this._smoothedRtt = this._smoothedRtt * (1 - a) + rttSample * a;
            }
        }

        // Evict acknowledged send-time entries (and any older).
        if (lastInputSeq !== 0) {
            this._lastSampledInputSeq = lastInputSeq;
            for (const k of this._sentInputTimes.keys()) {
                if (k <= lastInputSeq) this._sentInputTimes.delete(k);
                else break;
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
        this._lastSampledInputSeq = 0;
        this._sentInputCount = 0;
        this._sentInputTimes.clear();
    }
}
