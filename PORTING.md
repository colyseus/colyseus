# PORTING — Native SDK notes (C# / C / Lua / Haxe)

The prediction layer (`packages/sdk/src/predict/`, see `PREDICTION.md`) is slated
for the Native SDK ports. This doc records which parts of the JS implementation
are **semantic contract** (a port must reproduce them) and which are **JS-only
dev affordances** (a port may skip them or substitute a native mechanism, with
zero behavioral divergence). Add a section here whenever a porting-relevant
implementation choice lands.

## The dividing rule

Portable surface is **data over closures**: metadata-table walks, plain string
lists, scalar copies. Dev diagnostics are **non-semantic by construction** — they
forward every operation unchanged and only warn — so a port that drops them
behaves identically to one that keeps them. When adding a feature, keep the
semantic core expressible as data, and keep any JS-metaprogramming convenience
in a layer that can be deleted without changing behavior.

## Port manifest — the exact public surface (0.18)

What a native SDK implements, verbatim. Anything in `packages/sdk/src/` NOT
listed here is internal machinery or a JS-only dev affordance — porting it is
a bug, not thoroughness. (`stripInternal` enforces the same boundary on the
published JS types.)

### `Predict` (`predict/Predictor.ts`)

- **Lifecycle / config**: `Predict.get(room, opts?)` (static factory;
  auto-consumes `room.clock`), `mode` (getter), `setDefaults(opts)`,
  `dispose()`.
- **Attachment**: `attach(instance, config)`, `attachAll(...)` (collection
  form), `detach(instance)`.
- **Driver**: `tick(now)` — the one per-frame call; returns the frame's input
  send budget (fixed steps due) and drives every child spawned below.
- **Factories**: `reconciler(instance, opts)` → `Reconciler`, `sim(opts)` →
  `SimReconciler`, `defineEvent(opts)` → `PredictedEventChannel`,
  `spawns(...)` → `PredictedSpawns`.
- **Reads**: `value(instance, field)` (render), `valueAt(instance, field,
  time)` (logic, arbitrary server-time instant), `read(instance, fields,
  out?)` / `readAt(instance, fields, time, out?)` (batched — one projection
  per instance).
- **Option types**: `PredictMode`, `PredictOptions` (= `SmoothingOptions |
  ReckonOptions | RawOptions`), `PredictGetOptions`, `AttachConfig`
  (= `SmoothingConfig | ReckonAttachConfig`), `FieldSmoothing`,
  `PredictSpawnsOptions`, `ConfirmOn`.

### Rollback controllers (`predict/rollback.ts` + `reconciler.ts` / `simReconciler.ts`)

- **Shared base**: `tick(now)`, `reset()`, `dispose()`, `onDisposed(hook)`,
  `pendingCount`, `stepMs`, `drift`, `lastCorrection`, `lastCorrectionMag`,
  `reconcileSeq`, `dead`.
- `Reconciler` adds `state` (exact predicted state, mutable) and
  `value(field)`; `SimReconciler` adds `world`, `value(field)`, `pose()`.
- **`StepContext`** (the `step` callback's ctx): `dt`, `dtMs`, `tick`,
  `subSteps`, `subDt`, `subDtMs`, `isReplay`, `reckonTime`, `lagCompActive`,
  `memo(keyOrCompute, compute?)`, `predict(sink, payload)` (+ the structural
  `PredictSink`). Drift helpers: `classifyDrift`, `Drift`, `DriftStatus`.

### Optimistic events + spawns

- **`PredictedEventChannel`** (`defineEvent`): `predict(payload)`, `has(key?)`,
  `confirm(key?)`, `reject(key?)`, `pendingCount`, `clear()`, `prune()`,
  `dispose()`, `dead`; options `PredictedEventChannelOptions`,
  `DEFAULT_GRACE_TICKS`, declarative `confirmOn` settlement.
- **`PredictedSpawns`**: `attach(...)`, `spawn(local)` → `SpawnHandle` (`id`,
  `local`, `data`, `cancel()`, `accept()`), `entries()`, `entryFor(server)`,
  `value(entry, field)`, `bindReader(read)`, `alive(id)`, `tick(now)`,
  `prune()`, `clear()`, `dispose()`, `dead`; `SpawnCorrelation` /
  `SpawnEntry` types.

### Input handle (`input/InputHandle.ts`)

`data`, `mode`, `send()`, `onSend(listener)`, `reset()`, `at(seq)`,
`reckonTimeAt(seq)`, `epoch`, `lastProcessed`, `sentCount`, `pendingCount`,
`replayBufferSize`, and the advertised rates: `tickRate`,
`stepSeconds`/`stepMs`, `patchRate`, `subSteps`, `subStepSeconds`/`subStepMs`.

### Explicitly NOT ported

- `track` / `untrack` / `trackStepped` (+ `SteppedOptions` /
  `SimulateOptions`) — internal primitives under `attach`; stripped from the
  published types.
- The `PredictedEvents` store — internal settlement machinery behind the
  channel/spawn surfaces (a port may keep an equivalent private store).
- `valueRaw()` / `events()` — removed from the 0.18 surface; use `valueAt` at
  the present instant / `defineEvent`.
- The debug channel: `PredictCore` / `ProfileCore`, the `onTrack` stream, the
  `globalThis` debug registry (JS panel plumbing).
- The explicit-subset Proxy diagnostic (`stepView`) — substitute per language,
  see the dedicated section below.
- Divergence warn-throttle helpers (dev diagnostics).

## Reconciler `fields` auto-derivation (portable)

`predict.reconciler`'s `fields` option is optional; omitted, it defaults to every
scalar field the instance's schema declares (`scalarFieldsOf`,
`packages/sdk/src/predict/schema.ts`) — one walk over the schema metadata table
returning `{ fields, numeric }`. The explicit list stays a plain string array.
Nothing here is a closure; the whole feature is a table lookup at construction.

Per-target derivation source:

| Target | Mechanism |
|---|---|
| C#   | reflection over the schema attributes, or codegen at schema-compile time |
| C    | the schema metadata tables the codegen already emits |
| Lua  | the schema descriptor tables |
| Haxe | macro over the schema class |

Notes for ports:

- **Numeric vs verbatim split.** JS decides at construction by runtime `typeof`
  on the live decoded value; a typed port knows the split statically from the
  field type. Both are fine — the contract is *which fields smooth vs copy*
  (numeric → smoothed error correction, boolean/string → verbatim), not how the
  split is computed.
- `.noSync()` fields never appear in schema metadata, so the derivation cannot
  pick them up. Ports must preserve that property of their metadata source.
- The history-ring semantics (a non-number/boolean field in the mirror disables
  the wire-precision reconcile skip) are behavior, not a JS artifact — reproduce
  them.

## Explicit-subset dev diagnostic (JS-only — substitute or skip)

When an explicit `fields` list omits schema scalars, the JS reconciler hands
`step` a dev-only `Proxy` view of the predicted state that warns once per
undeclared field the step reads or writes (`stepView()`,
`packages/sdk/src/predict/reconciler.ts`). It exists because an incomplete list
does not error — replay integrates on a stale value and the entity rubber-bands
only under latency.

The **Proxy mechanism is not portable**; the diagnostic *concept* is, and each
port should use its most idiomatic form:

| Target | Substitute |
|---|---|
| Lua  | ports ~1:1 — `__index`/`__newindex` metamethods are exactly the get/set traps (use the empty-visible-table pattern so every access hits the metamethods) |
| C#   | prefer **compile-time**: an analyzer or source-generated check that `step` only references declared fields (runtime interception on plain objects isn't available without interfaces). Fallback: dev-build snapshot-diff |
| C    | dev-build **snapshot-and-diff**: copy the undeclared fields before `step`, compare after — catches writes |
| Haxe | macro-time field-access check, alongside the macro-generated schema descriptors |

What a substitute must honor to stay behavior-identical:

- **Dev-only, zero semantic impact.** It observes; it never alters what `step`
  reads or writes. Prod builds pay nothing.
- **Warn once per field, naming the field** — one actionable message, not spam.
- It watches only the state handed to `step`. Direct app-side mutation of the
  predicted state (the JS `me.state` channel) is a documented escape hatch and
  must never warn.

Two asymmetries to be aware of:

- **Write detection is portable everywhere** (snapshot-diff); *read* detection
  needs interception or a static check. Losing reads is acceptable — the
  motivating hazard is a write the replay can't reproduce — but static checking
  covers both, which is why compile-time is the preferred substitute where the
  language offers it.
- **Typed ports need the check more, not less.** In JS, reading an unmirrored
  field off the predicted state yields `undefined` — loudly broken. In a typed
  port the predicted state is the full struct, so an unmirrored field silently
  holds a stale value — exactly the failure the diagnostic exists to catch, with
  no runtime symptom until it rubber-bands.
