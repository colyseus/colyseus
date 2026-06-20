/**
 * Rolling reconcile-drift telemetry, shared by {@link Reconciler} and
 * {@link SimReconciler} so both report it identically.
 *
 * Each reconcile feeds the max |correction| (world/pose units) into a pair:
 *
 *   - **ema** — EMA of the magnitude: the *persistent* component. A steady
 *     nonzero `ema` means the prediction is genuinely *diverging* from the
 *     server (wrong `dt`, a non-shared `step`, a skipped input) — the
 *     rubber-banding you otherwise can't tell apart from jitter.
 *   - **peak** — a decaying max: *recent* spikes. A `peak` well above a low
 *     `ema` is network *jitter* (occasional rollbacks), not divergence.
 *
 * Both ~0 ⇒ the prediction matched the server. Fed once per reconcile (patch
 * rate, not per render frame), so the cost is two flops.
 */
export interface Drift {
    /** EMA of reconcile-correction magnitude — the persistent/divergence component. */
    ema: number;
    /** Decaying max of reconcile-correction magnitude — recent jitter spikes. */
    peak: number;
}

const DRIFT_EMA_ALPHA = 0.1;
const DRIFT_PEAK_DECAY = 0.9;

/** A fresh zeroed {@link Drift}. */
export function newDrift(): Drift {
    return { ema: 0, peak: 0 };
}

/** Fold one reconcile's max |correction| (`mag`, world/pose units) into `d`. */
export function updateDrift(d: Drift, mag: number): void {
    d.ema += (mag - d.ema) * DRIFT_EMA_ALPHA;
    d.peak = Math.max(mag, d.peak * DRIFT_PEAK_DECAY);
}

/** Zero `d` — call on a hard resync (respawn) so a deliberate pose jump doesn't
 *  inflate the telemetry into looking like divergence. */
export function resetDrift(d: Drift): void {
    d.ema = 0;
    d.peak = 0;
}

/** The actionable read of the rolling drift — see {@link classifyDrift}. */
export type DriftVerdict = "matched" | "jitter" | "diverging";

/** Drift (world/pose units) at or below this is treated as float-noise:
 *  deterministic replay reproduces the server *exactly* (correction 0), so
 *  anything at this level is bit-rounding, not a real disagreement. Used as the
 *  matched/diverging floor only when the caller declared no tolerance. */
const FLOAT_NOISE = 1e-3;

/**
 * Turn the rolling {@link Drift} into an actionable verdict. The debug panel and
 * the `warnOnDivergence` warning both classify through here, so they can never
 * disagree about what the numbers mean:
 *
 *   - **matched** — `ema` and `peak` both within the floor: the prediction
 *     reproduces the server. Nothing to do.
 *   - **jitter** — `ema` within the floor but `peak` above it: corrections
 *     happen yet DON'T persist (they decay out of the EMA) → transient network
 *     jitter (packet loss / reorder), not a bug; smoothing absorbs it.
 *   - **diverging** — `ema` above the floor: the *persistent* correction is real
 *     → the client and server simulations disagree (a determinism bug).
 *
 * The EMA's smoothing IS the persistence test — a one-off spike barely moves it,
 * so only sustained corrections read as `diverging`. The floor is the caller's
 * `tolerance` (`warnOnDivergence`) when set — so the matched/diverging cut needs
 * no game-specific magic number — and falls back to {@link FLOAT_NOISE} ("is it
 * ~0") when it isn't.
 */
export function classifyDrift(d: Drift, tolerance?: number): DriftVerdict {
    const floor = tolerance !== undefined && tolerance > FLOAT_NOISE ? tolerance : FLOAT_NOISE;
    if (d.ema >= floor) { return "diverging"; }
    if (d.peak >= floor) { return "jitter"; }
    return "matched";
}
