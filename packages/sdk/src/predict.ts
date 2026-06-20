/**
 * High-level prediction primitives — passive smoothing, server-reconciled
 * rollback, and optimistic discrete events — built on top of the SDK's
 * `room.input()` / `room.clock` handshake.
 *
 * One `Predict` per room is the usual shape:
 *
 *     import { Predict } from "@colyseus/sdk/predict";
 *     // (or `import { Predict } from "@colyseus/sdk"` — both reach the same
 *     // module; the subpath form is slightly more bundler-friendly.)
 *
 *     const predict = Predict.get(room, { mode: "lerp", delay: 80 });
 *     predict.attachAll("players", { fields: ["x", "y"], mode: "damped" });
 *     const me      = predict.reconciler(self, { input, fields: ["x","y"], step });
 *     const deaths  = predict.events();
 *
 *     // Per frame, one driver advances all three:
 *     predict.tick(performance.now());
 *
 * The {@link Reconciler}, {@link PredictedEvents} and the `Predict`-managed
 * attachment ring share their input/ack/replay/smoothing machinery; see each
 * file's docs for the underlying contracts.
 *
 * Debug surface: when `@colyseus/sdk/debug` is imported, this module's
 * `Predict` instances publish to a `globalThis.__colyseusDebug` registry the
 * debug panel polls. When the debug entrypoint isn't imported, the publish
 * is a no-op — the engine never references panel code directly.
 */

export {
    Predict,
    type PredictMode,
    type PredictOptions,
    type PredictGetOptions,
    type AttachConfig,
    type SmoothingOptions,
    type SmoothingConfig,
    type FieldSmoothing,
    type ReckonOptions,
    type ReckonAttachConfig,
    type RawOptions,
    type SteppedOptions,
    type SimulateOptions,
    type PredictCore,
    type ProfileCore,
} from './predict/Predictor.ts';

export {
    Reconciler,
    type ReconcilerOptions,
    type StepContext,
} from './predict/reconciler.ts';

export {
    classifyDrift,
    type Drift,
    type DriftVerdict,
} from './predict/drift.ts';

export {
    SimReconciler,
    type SimReconcilerOptions,
} from './predict/simReconciler.ts';

export {
    PredictedEvents,
    DEFAULT_TTL_POLICY,
    type PredictedEventsConfig,
    type PredictedEventsClock,
    type PredictedEventsGetOptions,
} from './predict/predictedEvents.ts';

export {
    PredictedSpawns,
    type PredictedSpawnsOptions,
    type PredictedSpawnsClock,
    type SpawnCorrelation,
    type SpawnEntry,
    type SpawnHandle,
} from './predict/predictedSpawns.ts';
