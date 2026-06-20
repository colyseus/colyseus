/**
 * Bridges a Predict's engine-level `PredictCore` (published to the global
 * `__colyseusDebug` registry) into the panel-facing `PredictDebugHandle` that
 * the debug card renders.
 *
 * The engine deliberately exposes only portable state; everything panel-shaped
 * — notably the profile → field-names mapping shown on each sub-card — is
 * derived HERE by subscribing to the core's `onTrack` stream, so none of it
 * lives in (or has to be ported with) the engine.
 *
 * Duck-typed: no import dependency on the engine, so engine-side refactors
 * don't force SDK churn.
 */

type StepFn = (state: any, dt: number, elapsedMs: number) => void;
type SmoothMode = "lerp" | "extrapolate" | "damped";
export type PredictMode = SmoothMode | "reckon" | "raw";

/** Engine-level profile snapshot, as published by Predict (no `fields`). */
export interface ProfileCore {
    readonly id: number;
    readonly isDefault: boolean;
    /** Attach-group this profile belongs to (collection key passed to
     *  `attachAll`, or "(attach)" for standalone attaches). */
    readonly label?: string;
    readonly mode: PredictMode;
    readonly delay: number;
    readonly damping: number;
    readonly maxExtrapolate: number;
    readonly tickInterval: number;
}

/**
 * Engine-introspection contract Predict publishes to the registry. Exposes only
 * portable state plus an `onTrack` subscription the bridge uses to reconstruct
 * the per-profile field list.
 */
/** The actionable read of a reconciler's drift. */
export type DriftVerdict = "matched" | "jitter" | "diverging";

/** Per-reconciler drift snapshot — mirrors the engine's `ReconcilerStat`
 *  (duck-typed; no engine import). */
export interface ReconcilerStat {
    readonly label: string;
    readonly verdict: DriftVerdict;
    readonly severity?: number;
    readonly ema: number;
    readonly peak: number;
    readonly lastCorrectionMag: number;
    readonly reconcileSeq: number;
}

export interface PredictCore {
    readonly name: string;
    mode(): PredictMode;
    smoothingDefaults(): { mode: PredictMode; delay: number; damping: number; maxExtrapolate: number; tickInterval?: number };
    reckonDefaults(): { step: StepFn | undefined; smoothing: number; substep: number };
    attachedCount(): number;
    reconcilers(): ReconcilerStat[];
    setDefaults(opts: any): void;
    profiles(): ProfileCore[];
    setProfile(id: number, opts: any): void;
    onTrack(cb: (profileIdx: number, field: string) => void): () => void;
    onDispose(cb: () => void): () => void;
}

/** Panel-facing profile snapshot — core profile plus the derived field list. */
export interface ProfileInfo extends ProfileCore {
    /** Field names that have been associated with this profile (any instance). */
    readonly fields: readonly string[];
}

/**
 * Panel-facing handle — identical to the core except `profiles()` carries the
 * derived `fields`, and `onTrack` is consumed internally (not re-exposed).
 */
export interface PredictDebugHandle {
    readonly name: string;
    mode(): PredictMode;
    smoothingDefaults(): { mode: PredictMode; delay: number; damping: number; maxExtrapolate: number; tickInterval?: number };
    reckonDefaults(): { step: StepFn | undefined; smoothing: number; substep: number };
    attachedCount(): number;
    reconcilers(): ReconcilerStat[];
    setDefaults(opts: any): void;
    profiles(): ProfileInfo[];
    setProfile(id: number, opts: any): void;
    onDispose(cb: () => void): () => void;
}

/**
 * Wrap an engine `PredictCore` into the panel's `PredictDebugHandle`,
 * maintaining the profile → field-names map from the core's track stream.
 *
 * The core is published during Predict's construction — before any
 * attach/track — so subscribing synchronously here misses no track event. No
 * removal on detach: a field name stays listed even after every instance
 * detaches, which is the right behaviour for a debug overview (and matches the
 * old engine-side `profileFields`).
 */
export function toDebugHandle(core: PredictCore): PredictDebugHandle {
    const fieldsByProfile = new Map<number, Set<string>>();
    core.onTrack((profileIdx, field) => {
        let s = fieldsByProfile.get(profileIdx);
        if (!s) { s = new Set(); fieldsByProfile.set(profileIdx, s); }
        s.add(field);
    });
    return {
        name: core.name,
        mode: () => core.mode(),
        smoothingDefaults: () => core.smoothingDefaults(),
        reckonDefaults: () => core.reckonDefaults(),
        attachedCount: () => core.attachedCount(),
        reconcilers: () => core.reconcilers(),
        setDefaults: (opts) => core.setDefaults(opts),
        setProfile: (id, opts) => core.setProfile(id, opts),
        onDispose: (cb) => core.onDispose(cb),
        profiles: () => core.profiles().map((p) => ({
            ...p,
            fields: fieldsByProfile.get(p.id) ? [...fieldsByProfile.get(p.id)!] : [],
        })),
    };
}
