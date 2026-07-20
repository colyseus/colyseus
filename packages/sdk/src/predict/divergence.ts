import { now } from "../core/utils.ts";
import { debugOverlayActive } from "../debug-channel.ts";

/**
 * True when drift telemetry is being watched — the `@colyseus/sdk/debug` overlay
 * is loaded (its live receiver on `globalThis.__colyseusDebug` is what the panel
 * reads). Reconcilers skip ALL drift/correction bookkeeping when this is false
 * and no `warnOnDivergence` tolerance is set, so a production build that imports
 * neither pays nothing for the diagnostic.
 *
 * Delegates to {@link debugOverlayActive} so the pre-load PUBLISH BUFFER (which a
 * plain `Predict`/room publish now installs even without the overlay) doesn't
 * read as active — only the overlay's live receiver flips this on.
 */
export function diagnosticsActive(): boolean {
    return debugOverlayActive();
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
        `late frames. Send the frame's due inputs right after predict.tick(now) — tick and pump in ` +
        `your earliest per-frame callback, before anything reads value()/pose(). For game logic ` +
        `(zone checks, hit-reg) read .state/.world instead. See PREDICTION.md §4 (frame order).`,
    );
}

/**
 * Dev-only memo collision warning ({@link diagnosticsActive}-gated, warn-once
 * per key per store). Fired when two `ctx.memo` calls in ONE step land on the
 * same slot — two key-less calls, or the same explicit key twice. The live
 * calls each run their compute (last write wins the slot), but every replay of
 * that seq returns the ONE frozen value to both call sites — a silent,
 * latency-dependent re-simulation corruption. Warns instead of throwing: a
 * single key-less memo per step is the common, correct form.
 */
export function warnMemoCollision(tick: number, key: string): void {
    console.warn(key === ""
        ? `@colyseus/sdk predict: two key-less ctx.memo calls ran in one step (input seq ${tick}) — ` +
          `the key-less form is ONE shared slot per step, so replay returns one frozen value for ` +
          `both (silent re-simulation corruption). Pass distinct keys: ctx.memo("a", …) / ctx.memo("b", …).`
        : `@colyseus/sdk predict: ctx.memo("${key}") ran twice in one step (input seq ${tick}) — ` +
          `both calls share one slot on replay. Give each call site its own key ` +
          `(include the loop index for a per-iteration memo).`,
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
