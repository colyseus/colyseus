import { now } from "../core/utils.ts";

/**
 * True when drift telemetry is being watched — the `@colyseus/sdk/debug` bundle
 * is loaded (it installs `globalThis.__colyseusDebug`, which the panel reads).
 * Reconcilers skip ALL drift/correction bookkeeping when this is false and no
 * `warnOnDivergence` tolerance is set, so a production build that imports neither
 * pays nothing for the diagnostic. Same global the engine's `getDebugRegistry`
 * checks, by reference — no import coupling to the debug module.
 */
export function diagnosticsActive(): boolean {
    return typeof globalThis !== "undefined"
        && (globalThis as { __colyseusDebug?: unknown }).__colyseusDebug != null;
}

// -Infinity (not 0) so the FIRST warning always fires: `now()` can be < the
// throttle window early in a process, and `now() - 0` would wrongly suppress it.
let _lastWarnAt = -Infinity;
const WARN_THROTTLE_MS = 1000;

/** @internal Reset the cross-controller warn throttle. For tests only. */
export function resetDivergenceThrottle(): void {
    _lastWarnAt = -Infinity;
}

/**
 * Wiring warning, fired (once per controller) when a render value was read
 * BETWEEN `predict.tick()` and the frame's `input.send()` calls. Such a read is
 * one fixed step stale — the render interpolation clamps at the latest applied
 * step (it never extrapolates), so on late step-boundary frames the read
 * flat-tops, and frame jitter renders as visible stutter on fast objects.
 * Default-on (like the input replay-buffer overflow warning): this is a frame-
 * order bug with an established fix, not tuning telemetry.
 */
export function warnReadBeforePump(): void {
    console.warn(
        `@colyseus/sdk predict: a predicted value was read BEFORE this frame's input.send() calls. ` +
        `Reads between predict.tick() and the frame's sends are one fixed step stale and stutter on ` +
        `late frames. Register your send loop with predict.onStep(cb) — tick() then runs it at the ` +
        `right moment — or send the due inputs right after predict.tick(now), before anything reads ` +
        `value()/pose(). For game logic (zone checks, hit-reg) read .state/.world instead. ` +
        `See PREDICTION.md §4 (frame order).`,
    );
}

/**
 * Dev-only divergence warning, wired by the opt-in `warnOnDivergence` tolerance
 * on a {@link Reconciler}/{@link SimReconciler}. Fired when the reconciler's
 * verdict is `diverging` (the *persistent* drift `ema` crossed the tolerance —
 * NOT a single jitter spike), throttled to one warning per second across all
 * reconcilers so a sustained divergence doesn't flood the console.
 *
 * The reconcile correction IS the client-vs-server divergence (the client
 * already holds the server's authoritative state it reconciles against), so this
 * needs no extra wire traffic. It names the input seq, the worst field + its
 * signed delta, and the usual cause — actionable, not just "something's off".
 */
export function warnDivergence(
    acked: number,
    lastCorrection: Record<string, number>,
    ema: number,
    tolerance: number,
): void {
    const t = now();
    if (t - _lastWarnAt < WARN_THROTTLE_MS) { return; }
    _lastWarnAt = t;

    let worst = "";
    let worstAbs = -1;
    for (const f in lastCorrection) {
        const v = lastCorrection[f];
        const a = v < 0 ? -v : v;
        if (a > worstAbs) { worstAbs = a; worst = f; }
    }
    const delta = worst ? lastCorrection[worst] : ema;
    console.warn(
        `@colyseus/sdk predict: prediction is diverging at input seq ${acked} — ` +
        `rolling drift ${ema.toFixed(3)} ≥ tolerance ${tolerance}; "${worst}" currently off by ${delta.toFixed(3)}. ` +
        `Most likely the client and server simulations disagree: a different fixed dt, ` +
        `mismatched constants, a step function that isn't shared, or an input the server skipped. ` +
        `See PREDICTION.md §5 (Determinism).`,
    );
}
