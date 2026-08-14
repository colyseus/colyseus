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
- **Driver**: `tick(now?)` — the one per-frame call; returns the frame's input
  send budget (fixed steps due) and drives every child spawned below. Omit
  `now` and the SDK reads its own room clock, so a caller never has to pick a
  platform clock and risk a different epoch. Optional in JS, Defold, Unity,
  Haxe, Flutter and Godot; GDScript has no nullable float default and uses a
  negative sentinel. Still required by the C core
  (`colyseus_predict_tick(p, now)`) and the GameMaker binding, which have no
  clock handle at the call site.
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
  `SpawnsOptions`, `ConfirmOn`.

### Rollback controllers (`predict/rollback.ts` + `reconciler.ts` / `simReconciler.ts`)

- **Shared base**: `tick(now)`, `reset()`, `dispose()`, `onDisposed(hook)`,
  `pendingCount`, `stepMs`, `drift`, `lastCorrection`, `lastCorrectionMag`,
  `reconcileSeq`, `dead`.
- `Reconciler` adds `state` (exact predicted state, mutable) and
  `value(field)`; `SimReconciler` adds `world`, `value(field)`, `pose()`.
- Both `step` callbacks share ONE shape — `(ctx, <the-thing-you-mutate>,
  command)`: `step(ctx, state, command)` / `step(ctx, world, command)`.
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

### Room clock (`RoomClock.ts`)

- **`RoomClock`** — the contract `room.clock` GUARANTEES (never null; a frozen
  null-object stub pre-handshake): `now()`, `serverNow()`, `renderNow()`,
  `rtt()`, `smoothedRtt()`, `jitter()`, `lastServerTime()`, `patchInterval()`,
  `setPatchInterval(ms)`, `sample(sNow, rttSample)`.
- **`RoomClockLike`** — the loose ACCEPT type (what Predict takes; `renderNow`
  and the patch-interval pair optional). A typed port may collapse the pair
  into one interface if optional members don't translate.

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
`packages/sdk/src/core/schema-reflect.ts`) — one walk over the schema metadata table
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

## Unreliable state patches (portable — decoder-side)

> Both unreliable sections below only engage on a transport with a datagram
> channel. Today that is WebTransport alone (`@colyseus/h3-transport`, still
> experimental); over any WebSocket transport this traffic travels the reliable
> channel, so a port targeting WebSocket only can skip both and lose nothing.

A field marked `@unreliable` server-side is never emitted into a reliable state
patch. It ships on the transport's unreliable channel, so a port that speaks a
datagram transport must recognize a second patch envelope:

```
[ROOM_STATE_PATCH | ProtocolModifier.UNRELIABLE (0x40)][uint16 seq LE][...schema bytes]
```

The body is an ordinary patch payload — the existing decoder handles it
unchanged; there is no new opcode and nothing in `Reflection` marks the field.
Two rules a port must reproduce:

- **Drop stale frames.** Keep the seq of the newest frame applied; apply an
  incoming frame only when `(int16)(seq − lastApplied) > 0`. The comparison is
  wrap-safe at 65536 — a plain `>` breaks at the wrap and orders only half the
  range. Reset the baseline to `0` on every full state sync (`ROOM_STATE`), which
  is what re-baselines a rejoin.
- **Never gate the reliable channel on it.** A patch without the `UNRELIABLE`
  bit carries no seq and is always applied.

On a **state patch**, `UNRELIABLE` and `TIMED` are never set together, so the two
prefixes don't compose and can be read independently. (Client→server INPUT
opcodes are a separate story — see the input stamp block below, where `TIMED`
rides the unreliable opcode by design.)

Why this is safe to decode out of order at all: `@unreliable` is rejected at
schema-definition time for ref-type fields, so every ADD/DELETE of a ref still
travels the reliable channel. A lost or reordered datagram costs a stale field
value and can never desync the ref graph. A port needs no recovery path beyond
the seq check.

### Unknown refIds are expected on this channel

A port's decoder **will** meet a `SWITCH_TO_STRUCTURE` naming a refId it has
never seen, and must treat it as routine: skip that structure and continue, the
way the JS decoder already does. It is not corruption and not worth reporting to
the user. Two ways it arises, both measured:

- **Spawn.** An entity's ADD rides the reliable channel; its `@unreliable`
  fields ride datagrams. When the server flushes the unreliable channel between
  reliable patches, the datagram legitimately precedes the ADD — `patchRate ÷
  unreliablePatchRate` such frames per mid-session spawn (measured at 118 over
  8s with 200ms/20ms and ~10 spawns/s). Flushing in step with the patch instead
  measured 0.
- **Despawn.** A datagram already in flight when the entity is removed. The
  removal is authoritative — the entity must NOT be resurrected.

Related asymmetry a port should not be surprised by: a full state sync carries
`@unreliable` field values (they are part of `encodeAll`), but a mid-session ADD
does not. An entity added while connected therefore arrives with those fields
unset until the first datagram that carries them, which for a per-tick field is
the next unreliable flush.

Transports with no datagram channel receive nothing on this envelope — the
server skips them rather than falling back — so a WebSocket-only port has
nothing to implement here.

## Lag-comp stamp on unreliable inputs (portable — encoder-side)

A room that rewinds (`allowRewindState` + a rewind group) asks clients to stamp
each input with the timeline instant it was sampled at. The handshake says which
timeline via `InputFlags.RENDER_TIME` / `RECKON_TIME`; the wire shape then
depends on the CHANNEL, because the two have different guarantees.

`ROOM_INPUT_RELIABLE | TIMED` — one delta-coded stamp, against a running
baseline both sides re-zero on (re)connect. Cheap (~1 byte), and safe only
because delivery is ordered and lossless.

`ROOM_INPUT_UNRELIABLE | TIMED` — a self-contained block ahead of the ring body:

```
[varint k][uint32 newest][varint Δ]×(k−1)
[uint16 rdNewest][varint Δrd]×(k−1)        ← BOTH mode only
```

- `k` is the number of slots in this packet's ring — what
  `InputDecoder.decodeAll` will yield, oldest→newest. Stamps pair positionally
  with those yields.
- `newest` is THIS send's instant, absolute. Each Δ walks one slot older:
  `stamp[i] = stamp[i+1] − Δ`.
- The `renderDelta` series is present only when BOTH timeline flags are set, and
  is written in the same shape — one value per slot, reconstructed the same way
  (`rd[i] = rd[i+1] − Δrd`). Consecutive values differ by ~0–1 ms, so each costs
  one byte; per-slot exactness is `k−1` bytes over a single shared value.

Two rules a port must reproduce:

- **Never delta-code across packets on this channel.** The whole point of the
  absolute anchor is that a lost or reordered packet can't desync anything, and
  that an input recovered redundantly from a later packet still arrives carrying
  the instant it was sampled at.
- **Track `k` explicitly, don't derive it from the seq.** The framework seq is
  monotonic across `reset()`, but `reset()` drops the encoder's ring — deriving
  `k` from the seq would claim slots the packet doesn't carry. Count sends into
  the ring instead, clamped to `historySize`, and zero it on reset.

The block is all-or-nothing — every slot stamped, or no block at all. A port's
`allowRewind` equivalent gates the RELIABLE opcode only: the unreliable block
ships whole, so excluding one slot saves nothing and makes its neighbour's delta
swing the full absolute value. Slots sampled before the client's clock synced
ship as `0`, the same "unstamped, read live" sentinel used everywhere else.

A packet with no `TIMED` bit is read live in full, so a port can ship the input
path before the stamp block.
