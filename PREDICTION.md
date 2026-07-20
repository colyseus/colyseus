# Client-side prediction & lag compensation (Colyseus 0.18)

Colyseus 0.18 ships first-class primitives for **server-authoritative simulation
with client-side prediction**: zero-latency local control, smooth remote entities,
and "what you see is what you hit" lag-compensated hits — without hand-rolling a
netcode stack.

This guide puts the **server half** (`defineInput` + `setFixedTimestep` +
`allowRewindState`) next to the **client half** (`room.input` + `Predict` /
`reconciler` / `sim`) with the load-bearing rules in one place.

> **Runnable references**
> - `test/prediction/` — hand-rolled platformer (no physics engine).
> - `demos/multiplayer-2d-shooter-prototype/` — Rapier2D physics shooter.
> - `demos/fps-demo/` — 3D FPS (hitscan + capsule hitboxes).
>
> Porting this layer to the Native SDKs (C# / C / Lua / Haxe)? See `PORTING.md`
> for what is semantic contract vs JS-only dev affordance.

---

## 1. Mental model

- The **server** runs the authoritative simulation at a **fixed tick rate**.
- The **client predicts** its own entity locally from the same step function, then
  **reconciles** to the server's authoritative state (rollback + replay of
  unacknowledged inputs), smoothly correcting any mismatch.
- **Remote** entities are smoothed from the server stream (interpolated a little in
  the past, or dead-reckoned forward).
- For hits, the server **rewinds** other entities to where the shooter *saw* them
  (their render time), so a well-aimed shot at a moving target registers.

One input per fixed step; one `predict.tick(now)` per render frame drives everything.

---

## 2. Server

```ts
import { Room } from "@colyseus/core";

class GameRoom extends Room {
  state = new GameState();

  // Per-client input schema (flat primitives only). Lag-comp stamps ride the
  // input channel automatically once rewind is armed — no flag to set.
  input = this.defineInput(MoveInput, { bufferMaxSize: 64 });

  // Records attached entities' positions (auto, on each broadcast — snapshots
  // exactly what clients receive, so patchRate ≠ timestep stays exact).
  rewind = this.allowRewindState({ maxRewindMs: 500 });

  onCreate() {
    this.rewind.attachAll(this.state.players, { fields: ["x", "y"] });
    // Fixed-step loop @ 30 Hz — advertises the rate to predicting clients.
    this.setFixedTimestep((ctx) => this.step(ctx), 30);
  }

  step(ctx) {
    for (const [sid, p] of this.state.players) {
      // Consuming the buffer — pick ONE:
      //  • per-entity integration → drain() all and sub-step each:
      //      for (const cmd of this.inputs.get(sid).drain()) applyInput(p, cmd, ctx.dt);
      //  • one shared solver step for everyone → next() exactly one per tick:
      //      const cmd = this.inputs.get(sid).next(); if (cmd) applyInput(p, cmd, ctx.dt);
    }
    // ...advance world, then hit tests (see §6 lag comp).
  }
}
```

- **`defineInput(Input, opts)`** — declares the per-client input schema and buffers
  inbound frames. Display-time stamps auto-enable from the rewind `attachAll` `mode`
  of the groups you rewind — no flag; each stamped reliable input carries 6 extra
  bytes (read via `inputs.get(sid).renderTime`, or — better — `rewind.lastSeenBy(sid)`).
- **`setFixedTimestep(step, hz)`** — framework-owned accumulator loop; each `step`
  advances by the SAME fixed `dt = 1/hz`, and the rate is advertised to clients so
  they predict at the matching `dt`. (Don't also pass `tickRate` to `defineInput`.)
- **`allowRewindState({ maxRewindMs })`** + **`rewind.attachAll(collection, { fields })`** —
  records the numeric `fields` of every entity in the collection on each broadcast
  (snapshotting exactly what clients receive; `rewind.record()` takes over the cadence).

### Consuming input: `drain()` vs `next()`

- **`drain()`** — take ALL buffered frames; right when each entity integrates itself
  (N inputs ⇒ N sub-steps). The ack (`lastProcessed`) lands on the newest.
- **`next()`** — take exactly ONE; right for a single shared solver step that moves
  every body together (consume one input per entity, then step the world once).
  Draining all but simulating only the latest would jump the ack past inputs you
  never ran.

### Never trust the wire: `sanitize`

The wire carries whatever the client encodes — an `int8` movement axis can arrive
as `127` (a speed hack), a `float32` as `NaN`. Declare each field's legal domain
once at `defineInput`; every decoded frame is fixed up IN PLACE before anything
reads it (`latest`, the buffer, the `idle` ctx):

```ts
input = this.defineInput(MoveInput, {
  bufferMaxSize: 64,
  sanitize: {                               // map form — range clamps
    moveF: [-1, 1], moveR: [-1, 1],
    pitch: [-PITCH_LIMIT, PITCH_LIMIT],
    dt: [0, MAX_DT],
  },
  // or a callback for anything beyond ranges:
  // sanitize: (f) => { f.angle = wrapAngle(f.angle); },
});

// the sim loop consumes frames directly — no per-frame clamp/copy:
for (const f of inputCh.drain()) stepPlayer(p, f, world);
```

- Sanitizers **modify, never reject** — a malformed value becomes a legal one.
- The map form is **NaN-safe**: NaN lands on the clamp floor (`dt NaN → 0`), closing
  the classic `Math.min(NaN, …)` poisoning hole that hand-rolled clamps share.
- Honest clients are unaffected (in-range values are identity) — so client-side
  prediction never diverges from the server's sanitized values.
- Pairs with `t.int8<-1 | 0 | 1>()` type refinement: the generic types the field,
  `sanitize` enforces it at runtime.
- Semantic validation ("slot must name an owned weapon") stays in your sim — this
  handles value domains, not game rules.

### Empty ticks: the `idle` policy

What does "no input this tick" mean? Three policies, all expressible — declared
**once** at `defineInput({ idle })`; bare `drain()`/`next()` apply it automatically:

- **Skip** (default) — don't declare `idle`: `drain()` returns `[]`, the loop doesn't
  run. Right for strict fixed-timestep where the client sends one input per step and
  the server just waits.
- **Synthesize** — declare a policy: an empty tick yields one frame — the schema's
  **defaults** overlaid with the policy's overrides. Gravity keeps integrating;
  action guards (`if (f.fire)`) naturally no-op on defaults. The callback form runs
  lazily (only on actually-empty ticks) with `{ latest, sessionId }`, and closes over
  the room — entity lookups, liveness checks, `this.clock.deltaTime`:

  ```ts
  input = this.defineInput(MoveInput, {
    bufferMaxSize: 64,
    idle: ({ latest, sessionId }) => {
      const p = this.state.players.get(sessionId);
      if (!p) return true;
      return { yaw: p.yaw, dt: this.clock.deltaTime / 1000, plant: !!latest?.plant };
    },
  });

  // the sim loop — nothing to pass, no empty-branch:
  for (const f of inputCh.drain()) stepPlayer(p, f, world);
  ```
- **Hold everything** — return the whole last input as the idle frame: a held key
  keeps moving through a packet gap. Gate it on the client still being connected
  (userland judgment), or a drop keeps "walking" for the whole reconnection window:

  ```ts
  idle: ({ latest, sessionId }) =>
    (this.clients.getById(sessionId)?.state === ClientState.JOINED && latest) || true,
  // …
  const cmd = this.inputs.get(sid).next();   // typed I — never undefined
  ```

The policy also covers **absent sessions** — a player that dropped but is still
inside its `allowReconnection` window, so its entity lingers in `state` while it's
out of `this.clients`. `inputs.get(sessionId)` resolves through an input-owned
registry that outlives the connection, so the loop keeps synthesizing idle for the
dropped seat with no `if (!cmd) continue` — the entity holds at rest (or coasts on
the hold-everything policy) until it reconnects or `onLeave` deletes it. Liveness
stays a userland check inside the callback (`this.clients.get(sessionId)?.state ===
ClientState.JOINED`), so held intents naturally gate off while disconnected.

Per-call `{ idle }` overrides the room policy for that call; `{ idle: false }`
suppresses it. When `idle` is declared, `next()` types non-optional `I`.

> ⚠️ A synthesized idle frame is **not a consumed input**: it advances neither the
> reconcile ack (`lastProcessed`) nor `renderTime`, and it's one reused instance
> per client — read it within the tick, don't store it.

> ⚠️ Don't build overrides by **spreading** a schema instance (`{ ...latest, dt }`) —
> schema fields are prototype accessors, so the spread copies none of them. Return
> `latest` itself (fields are copied by name), or name the fields you want.

---

## 3. Client

```ts
import { Predict } from "@colyseus/sdk/predict";

const predict = Predict.get(room, { mode: "lerp", delay: 100, name: "players" });

// Remote players: render 100ms in the past, interpolated between snapshots.
// `snap`: a per-sample jump beyond this many UNITS is a teleport (respawn,
// blink, warp) — the smoother resets and renders it as a cut instead of
// gliding across the gap. Value-space and time-free, so latency bursts can't
// false-trigger it; size it ≫ maxSpeed × patchInterval and < the smallest
// legitimate teleport. Applies per field — attach velocity-like fields (which
// legitimately jump, e.g. a dash start) in a separate call without it.
predict.attachAll("players", { mode: "lerp", fields: ["x", "y"], snap: 4 });

// Local player: server-reconciled prediction. Wiring this input through
// predict.reconciler binds lag-comp's renderDelay to the lerp `delay` above —
// you set the interp buffer ONCE (on Predict), nothing to keep in sync here.
const input = room.input({ mode: "reliable" });
const me = predict.reconciler(self, {
  input,                              // OBSERVED: each input.send() below is predicted
  step: (ctx, s, cmd) => applyInput(s, cmd, LEVEL, ctx.dt),   // SAME function as the server
  smoothing: 15,
  // fields: defaults to every scalar field of `self`'s schema. List explicitly
  // only to subset deliberately (hot server-driven scalars, string fields) —
  // a dev diagnostic then warns if `step` touches a field the list misses.
});

function frame(now) {                 // `now` = the rAF timestamp — pass it through
  const n = predict.tick(now);        // single driver; returns the SEND BUDGET (fixed steps due)
  for (let i = 0; i < n; i++) {       // one input per fixed step, not per frame
    input.data.moveX = readMoveX();   // stage the wire input…
    input.data.jump = takeJump();     // …edges latched — see "Buttons between steps"
    input.send();                     // transmit + predict + buffer for replay
  }
  // ONE read idiom — local and remote alike (`self` is backed by the
  // reconciler while it lives; raw state before spawn / after dispose):
  for (const [, p] of room.state.players) draw(predict.value(p, "x"), predict.value(p, "y"));
  requestAnimationFrame(frame);
}
```

- **`Predict`** — passive smoothing for entities you DON'T control. Modes:
  `lerp` (interpolate snapshots at `now − delay` — smooth, lagged, faithful),
  `extrapolate` (forecast — live, can overshoot), `damped` (ease toward latest —
  never exact, never jittery), `reckon` (dead-reckon via a step fn).
- **`reconciler`** — active prediction for ONE entity you control (flat `fields`).
  Render with `predict.value(instance, field)` — the same idiom as the remotes
  (the reconciler backs the read while it lives); read the raw predicted state
  via the `state` getter.
- **`sim`** — active prediction when your inputs affect MORE than one flat-field
  entity: COMPOSITE scalar state across several schema instances (a paddle + the
  puck it strikes, reconciled together), or an opaque physics engine. Decoded
  schema instances placed in its `world` are AUTO-BOUND — see below.
- **`room.clock`** — `serverNow()`, `smoothedRtt()`, `lastServerTime()`. Auto-populated
  from the TIMED prefix that rides input acks — **only when the room called
  `defineInput()`**.

### Buttons between steps: latch, then consume

Input is sampled once per FIXED step, not per render frame — and frames and steps
don't line up: a 120 Hz display on a 30 Hz tick runs a step every ~4th frame, and a
hitchy frame can run several. Two traps follow: a press on a **0-step frame** must
not be lost (it belongs to the next step), and a press spanning a **multi-step
frame** must not fire twice. "Is the key down right now?" sampling gets both wrong.

The pattern is always the same — **LATCH the press when it happens, CONSUME it
inside the step loop on exactly one step**:

```ts
let jumpLatched = false;
onKeyDown("Space", () => jumpLatched = true);   // latch: the tap happened

function frame(now) {
  const n = predict.tick(now);
  for (let i = 0; i < n; i++) {
    input.data.moveX = readAxis();    // held state: sample live, no latch
    input.data.jump = jumpLatched;
    jumpLatched = false;              // consume: fires on exactly one step
    input.send();
  }
}
```

Variants of the same shape:

- **Held buttons** (movement, auto-fire) sample the live state directly — no latch.
- **Buffered presses** (a jump buffer): latch with a timestamp; the consuming step
  decides whether it's still fresh.
- **Analog deltas** (pointer aim, mouselook): accumulate into a pending total and
  let each step consume its budget (`pending -= taken`) — fast motion carries over
  to later steps instead of clipping.

Latch OUTSIDE the loop, consume INSIDE it. Draining an edge anywhere else either
drops taps (0-step frames) or double-fires them (multi-step frames).

### Composite & engine state: `predict.sim`

`reconciler` mirrors a flat `fields` list off ONE schema instance. When your inputs
affect more than that, use `predict.sim`: you own a `world` and the SDK runs the
same predict → adopt-on-ack → replay loop over it.

**Composite scalars — the declarative case.** Put the DECODED schema instances
themselves in `world` and they are **auto-bound**: each entry is replaced in place
by a plain scratch **mirror** seeded from its scalar fields (`step` mutates the
mirror, never the decoded tree); on every ack the mirror is re-copied from the
instance — unconditionally, changed or not — before replay; and every numeric
field becomes a render-pose field, registered into `predict.value(instance,
field)` so bound entities render through the same idiom as everything else:

```ts
const input = room.input({ type: MoveInput });
const me = predict.sim({
  input,
  world: {
    paddle: player,            // decoded schema instance ⇒ auto-bound (x, y, …)
    puck:   room.state.puck,   // ⇒ auto-bound (x, y, vx, vy)
  },
  step: (ctx, cmd, w) => stepWorld(w, cmd, ctx.dt),      // the SAME fn the server runs
});
draw(predict.value(player, "x"), predict.value(room.state.puck, "x")); // one idiom
chase(me.world.paddle);        // RAW predicted state for logic — never the render read
```

Detection is by decode identity (an entry with a decoder-assigned refId is a truth
source), top-level entries only. A schema instance that ISN'T decoded throws (pass
the one from `room.state`, or a plain object for scratch); to keep a decoded
instance opaque on purpose, nest it below a plain wrapper. Bound sources are
pinned at construction — a server-side ref swap (`state.puck = new Puck()`) is not
followed. Capture bound parts via `me.world` AFTER construction (the mirror
replaces the instance on the world object itself).

**Opaque engine state.** Anything without a refId passes through untouched, and
the `adopt` / `pose` callbacks own it — a physics solver's `world` handle + body:

- `step(ctx, cmd, world)` — deterministic, **SHARED with the server**; advance `world`
  by `ctx.dt`. One-shot concerns split three ways by shape: `ctx.memo` for VALUES
  the sim consumes (frozen, replayed back), `ctx.predict` for EVENTS with
  settlement, and a plain `if (!ctx.isReplay) { … }` branch for fire-and-forget
  presentation (sound, particles, timestamps) — the branch IS the idiom; there is
  deliberately no wrapper API for it.
- `adopt(world)` — seed the server's authoritative scalars into the opaque entries
  on each ack, before replay. Runs AFTER the bound entries' auto-adopt, so it may
  derive from just-adopted mirrors. Required when nothing is bound.
- `pose(world)` — read the opaque entries into a flat render pose (`{ x, y, … }`);
  its fields compose with the bound entries' auto keys (`"paddle.x"`, `"puck.vx"`;
  custom keys win on collision). Read handle-side with `me.value("paddle.x")`
  (a flat key — no string-path eval, portable to C#/C).

```ts
const me = predict.sim({
  input,
  world: { world, body },      // engine handles — no refId ⇒ opaque
  step:  (ctx, cmd, w) => { applyInput(w.body, cmd); w.world.step(); },  // timestep = ctx.dt
  adopt: (w) => { w.body.setTranslation({ x: self.x, y: self.y }, true); },
  pose:  (w) => { const t = w.body.translation(); return { x: t.x, y: t.y }; },
});
```

The loop, keyed to network acks the app never sees directly — the lifecycle:

```
your render frame:
                                     ┌─ new ack? ─▶ bound pulls + adopt(world)  adopt server truth
  n = predict.tick(now) ─────────────┤             step(ctx,cmd,world) × pend   replay, isReplay=true
                                     │             refresh pose (once)
                                     └─ always ──▶ error decay
  n × { input.data.… = …;
        input.send()   } ────────────▶             step(ctx,cmd,world)          live, isReplay=false
                                                   refresh pose
  draw(predict.value(puck, "x"))     ◀── cached pose: interpolate + smooth, NO callbacks
```

> ⚠️ **Adopt reseeds SCALARS; replay re-derives the rest.** Bound fields are pulled
> unconditionally every ack (a frozen entity emits no delta, but replay has mutated
> the mirror — skipping the copy would double-apply inputs on the stale value).
> Engine-internal non-scalar state (contact caches, sleeping islands, solver
> accumulators) is NOT rolled back across reconcile — only what adopt restores plus
> what replay re-runs. Both shipped consumers (composite scalars; a physics-engine
> shooter reseeding position + velocity) are fully served by this. An engine that
> depends on internal state surviving reconcile would need a per-tick snapshot
> ring, which `sim` does not carry.

### Which primitive for which interaction?

| interaction | primitive |
|---|---|
| your own movement (one entity, flat fields) | `reconciler` |
| anything your inputs push / carry / throw (paddle + puck, vehicle + cargo) | `sim` (composite scalars) |
| your movement inside a physics engine (Rapier/crashcat) | `sim` (engine handle) |
| hitscan against others (instantaneous, server-owned target) | `allowRewindState` + `rewind.lastSeenBy` |
| remote players you don't control | `Predict` lerp |
| server-driven ballistics nobody touches | `Predict` reckon |

---

## 4. The contract — rules that are load-bearing (and easy to miss)

> ⚠️ **`lastProcessed` is the server's consumed count**, echoed via the TIMED prefix
> — it advances when the server `drain()`s/`next()`s/`clear()`s. Reconcile triggers
> when it advances; there's no seq field to manage.

> ⚠️ **Inputs must be flat primitives** — no nested schemas/collections in the input.

> ⚠️ **Input rate = fixed-step rate = server tick.** Change one, change all. Send one
> input per fixed step (not per render frame). Lowering `tickRate` to save bandwidth
> therefore also lowers the simulation rate — unless you sub-step (§5): physics can
> run at `tickRate × subSteps` while the wire stays at `tickRate`.

> ⚠️ **`room.clock` requires `defineInput()`.** Without it the clock is a stub
> (`serverNow()` falls back to `performance.now()`, `rtt`/`lastServerTime` are 0).

> ⚠️ **Lag comp rewinds to the *acting client's* render time, not the server's now.**
> `rewind.lastSeenBy(shooterId)` gets the direction right for you.

> ⚠️ **Frame order: `tick` → send → read.** Each frame, call `predict.tick(now)`,
> send the returned number of inputs, and only then read render values
> (`value()`/`pose()`). A read between `tick()` and the sends is one fixed step
> stale — the interpolation clamps at the latest applied step (it never
> extrapolates), so late frames flat-top and **fast objects visibly stutter**
> while slow ones look fine. The reconciler warns once when it detects the
> pattern. The idiom is the same everywhere: THE FRAME DRIVER OWNS INPUT —
> `const n = predict.tick(now); for (n) { input.data.… = …; input.send(); }` —
> and everything downstream only reads. In engines with per-object update
> callbacks, that driver is the earliest registered callback; `room.input()`
> returns the same handle everywhere, so the driver and the entity that predicts
> through it need no shared plumbing, and `tick()` returns 0 until a reconciler
> exists, so the loop self-gates before spawn. Corollary: game logic (zone
> checks, hit-reg) should read the exact predicted `.state`/`.world`, not
> `value()` — those reads are order-independent and aren't render-smoothed.

---

## 5. Determinism

Prediction matches the server only if both run the **same** simulation:

- **One shared `step`/`applyInput`** function (single source of truth), imported by
  client and server.
- **Identical fixed `dt`** on both sides (`setFixedTimestep` advertises it; the
  client `reconciler`/`sim` read it back).
- **Matching engine versions** for physics (e.g. the same Rapier build client/server).
- **Wire precision on reconciled fields.** Lossy wire types (`float32`; auto
  `number`, which rides float32 when the loss is < 1e-4) round the truth the
  client adopts. The `reconciler` defuses the direct hit automatically: it
  compares its prediction at the acked seq against the truth **at wire
  precision** and only adopts on a difference the wire can actually express (a
  real mispredict) — rounding noise never enters the rollback restore point.
  For full bit-exactness through a lossy wire, ALSO commit the shared step's
  state to wire precision at step end (`k.x = Math.fround(k.x)` for `float32`
  fields — both sides run the shared step, so both land on the same lattice
  and the authoritative state IS the wire state). Without that second half the
  two float64 sims sit a rounding-epsilon apart and knife-edge branches (a
  grounded check, a step-up test) can still occasionally flip.

### Diagnosing divergence vs jitter

Mispredictions are otherwise silent — you just see rubber-banding and guess. The
reconciler turns the per-reconcile correction into a rolling **drift** readout so
you can tell the two apart without guessing. It's **opt-in, so production pays
nothing**: the drift bookkeeping runs only when something is watching — you load
`@colyseus/sdk/debug`, or you set `warnOnDivergence`. Otherwise `me.drift` stays
zeroed and the reconcile loop does no telemetry work.

- **`me.drift.ema`** — EMA of the correction magnitude, the *persistent* component.
  A steady nonzero value is genuine **divergence** (different `dt`, a non-shared
  `step`, mismatched constants, an engine-version skew, or an input the server
  skipped) — i.e. constant rubber-banding even on a LAN.
- **`me.drift.peak`** — a decaying max, *recent spikes*. A peak well above a low
  `ema` is network **jitter** (occasional rollbacks that scale with packet loss),
  not divergence.
- **`me.lastCorrectionMag`** / **`me.lastCorrection`** — the most recent reconcile's
  max |correction| and the per-field breakdown, for a HUD.

Both `ema` and `peak` ~0 ⇒ the prediction matches the server. Same fields on `sim`.

```ts
// HUD: are we diverging, and by how much? (set warnOnDivergence — or load
// @colyseus/sdk/debug — to populate me.drift; it's zeroed otherwise.)
hud.textContent = `drift ${me.drift.ema.toFixed(2)}  peak ${me.drift.peak.toFixed(2)}`;

// Dev-only: warn (throttled ~1/s) once the PERSISTENT drift crosses a tolerance
// — i.e. real divergence, not a one-off jitter spike — naming the seq + worst
// field + likely cause. Costs no extra wire traffic. Leave unset in production.
const me = predict.reconciler(self, { input, fields, step, warnOnDivergence: 0.1 });
// → "@colyseus/sdk predict: prediction is diverging at input seq 412 —
//    rolling drift 0.420 ≥ tolerance 0.1; "x" currently off by 3.700 …"
```

Raw numbers alone don't tell you what to *do*, so the `@colyseus/sdk/debug` panel
turns them into a **verdict + action** per reconciler — `✓ matched` (nothing to
do), `~ jitter` (network, raise smoothing or ignore), or `✗ diverging` (a
determinism bug — check `dt` / shared `step` / constants / skipped inputs), with
the `warnOnDivergence` tolerance scaling the severity (`4.2× tol`). The verdict,
the panel colour, and the warning all run through one `classifyDrift`, so they
never disagree. Set a `warnOnDivergence` tolerance to anchor "matched vs
diverging" to *your* game's scale rather than a default float-noise floor.

### Sub-stepping: high-rate physics on a low network rate

By default the input/network rate IS the physics rate (the §4 coupling): asking for
"30 inputs/sec" used to force 30 Hz simulation. **Sub-stepping** is the escape hatch —
declare it once on the server:

```ts
this.setFixedTimestep((ctx) => {
  this.applyInputs(ctx);                                       // ONE input per client per step
  for (let i = 0; i < ctx.subSteps; i++) this.world.step(ctx.subDt);
}, 30, { subSteps: 2 });                                       // 30 inputs/sec, 60 Hz physics
```

One input still drives exactly one fixed step (the replay invariant is untouched);
*inside* it the engine integrates `subSteps` sub-steps of `subDt = dt / subSteps`.
The handshake cascades `subSteps` alongside `tickRate`, so the client reconciler's
`ctx` carries the **same** `subSteps`/`subDt` — your shared `step` function runs the
identical loop on both sides:

```ts
// shared client/server — works for subSteps 1 too (subDt === dt then)
step: (ctx, cmd, e) => {
  applyCmd(e.body, cmd);                                       // per-INPUT effect (impulses!)
  for (let i = 0; i < ctx.subSteps; i++) e.world.step(ctx.subDt);
},
```

Rules of thumb:

- Apply the **input once per step**, then integrate N sub-steps — applying an
  impulse-like input once per *sub*-step would double-fire it.
- Never hand-derive N or the sub-step dt on either side: read `ctx.subSteps` /
  `ctx.subDt` (both sides; also `input.subStepSeconds` on the client handle). One
  declared number, zero drift.
- Most games don't need this — render interpolation already smooths above the step
  rate. Reach for it when the *simulation* needs the extra Hz (fast projectiles,
  stacking, tunneling) on a constrained send rate.

---

## 6. Lag compensation — "what you see is what you hit"

The shooter sees remote targets **interpolated in the past** (`delay`) and **delayed by
the network** (≈ `rtt/2`). To honor their aim, the server rewinds each target to that
moment. Two pieces:

**Client** — tell the server the render time. Once the server arms rewind, the SDK
auto-stamps every reliable input with `serverNow() − renderDelay − rtt/2`
(0 until the clock syncs — the library resolves that sentinel to a live instant). You normally set nothing: wiring the input through
`predict.reconciler`/`predict.sim` binds `renderDelay` to the `Predict` lerp `delay`,
so the interp buffer and the rewind instant are one value. The SDK adds the latency
term itself. Override only to decouple them:

```ts
room.input({ mode: "reliable" });                  // renderDelay ← Predict lerp delay (auto)
room.input({ mode: "reliable", renderDelay: 80 }); // explicit override (rarely needed)
```

**Server** — rewind targets to where the shooter saw them:

```ts
// In your hit test, for a shot fired by `shooterId`:
const seen = this.rewind.lastSeenBy(shooterId);   // clamp + live-fallback baked in
for (const [, target] of this.state.players) {
  if (overlaps(bullet, seen.value(target, "x"), seen.value(target, "y"), HIT_RADIUS)) hit(target);
}
```

`lastSeenBy(sid)` resolves that client's stamped render time, **clamps** it to
`[now − maxRewindMs, now]` (anti-spoof / clock-skew bound), and **falls back to the
live position** when the client hasn't synced yet.

The view makes no assumption about your schema's field names — you name the shape:
`seen.value(e, field)` reads one tracked numeric field (same shape as the client's
`predict.value`), and `seen.read(e, fields, out?)` batches the fields *you* list into
an object (optionally a reused scratch — extra properties on it are left untouched):

```ts
const pos = seen.read(target, ["x", "y"]);           // { x, y }
seen.read(enemy, ENEMY_POS, this.seenScratch);       // zero-alloc: fills + returns the scratch
```

The batch is mirrored client-side as the same concept: `predict.read(e, fields, out?)`
batches render reads, and `predict.readAt(e, fields, time, out?)` samples every listed
field at one instant — running the forward reckon integration **once per entity**
instead of once per field (the hand-rolled `valueAt` loop pays one integration per
field).

> ℹ️ `at()`/`lastSeenBy` re-aim and return the room's **internal default view** — the
> usual one-view-at-a-time flow is zero-alloc with nothing to declare. Need two views
> alive at once (compare two shooters' perspectives)? Pass your own as `out`:
>
> ```ts
> const a = this.rewind.lastSeenBy(shooterA);                     // shared default view
> const b = this.rewind.lastSeenBy(shooterB, new RewindView());   // independent second view
> ```
>
> Don't store a view across calls or ticks — the default gets re-aimed by the next
> call, and any view's clamp goes stale at the next record.

> If you stamp render time yourself (or store it on the entity), use
> `rewind.at(time)` — the same view, but you supply the time.

**One delay, not two.** The input `renderDelay` is bound to the `Predict` lerp `delay`
when you wire the input through `predict.reconciler`/`predict.sim`, so the server rewinds
to the same instant that's on screen by construction — set the interp buffer once on
`Predict`. (If you pass `renderDelay` explicitly you own keeping them equal again.)
Reverting remotes to `damped` (no fixed delay) silently breaks the exact match — the
rewind then approximates.

### Other recipes

- **Hand-rolled sim** (`test/prediction` platformer) — `applyInput` is plain math;
  `attachAll(enemies, { interpolate: (e) => e.kind === "teleporter" ? "step" : "linear" })`
  keeps teleport snaps sharp under rewind.
- **Dead-reckoned types** — pick the lag-comp timeline per rewind attach:
  `rewind.attachAll(state.enemies, { fields, mode: "reckon" })`. The server's rewind
  then aims those entities at the client's reconstructed send instant (a reckon
  renderer already cancelled downstream latency — rewinding to the raw stamp would
  double-compensate); attach them `mode: "reckon"` client-side to match. `"snapshot"`
  (default) reads at the raw stamp; untracked entities read live.
- **Physics sim** (`2d-shooter`) — bridge Rapier into `predict.sim`'s `step` (the
  engine handle is your `world`); consume one input per tick with `next()` and
  `world.step()` once.
- **Remote smoothing** — `lerp` for players (faithful), `reckon` for AI you can
  forward-simulate, `damped` for "never jittery" cosmetic entities.
- **Projectiles** — predict the shooter's own shot on fire for zero-latency feedback;
  age incoming projectiles by `serverNow() − spawnTime` (lag-invariant); sweep
  client-side hit checks so fast projectiles don't tunnel.

---

## 7. Troubleshooting

| Symptom | Likely cause |
|---|---|
| Local player rubber-bands constantly | Non-determinism: different `dt`, divergent `step`, or engine-version mismatch. Confirm with `me.drift.ema` (steady nonzero ⇒ divergence, not jitter) or `warnOnDivergence` (§5). |
| A fast predicted object stutters "sometimes", but corrections are ~0 and `smoothing` changes nothing | `value()`/`pose()` read between `predict.tick()` and the frame's `input.send()` calls — one step stale, flat-tops on late frames (§4 frame order). Move the sends before any reads; the reconciler warns once when it sees this. |
| Remotes stutter / teleport | Interp `delay` too small (buffer underruns); raise it past 1–2 patch intervals, or check patch rate. |
| A respawn/teleport GLIDES or streaks across the map | The smoother interpolates the position jump like any motion. Set `snap` (value-space teleport threshold) on the attach: `attachAll("players", { fields: ["x","y"], snap: 4 })` — beyond-threshold sample deltas reset the smoother (all modes, reckon rebases included) and render as a cut. |
| "I hit them but no damage" on moving targets | Not rewinding (or rewinding to server-now). Use `rewind.lastSeenBy(shooterId)` (§6). |
| Hits register *behind* a dead-reckoned target (where it already walked) | The type renders forward-reckoned but rewinds to the raw stamp (double compensation). Attach it `mode: "reckon"` on both sides (`rewind.attachAll` server, `predict.attachAll` client). |
| Hits land slightly ahead of the crosshair | `MAX_REWIND_MS` too small — it truncates the real rewind (`renderDelay + RTT + a tick`); raise it. |
| `rewind.lastSeenBy` throws | The room never called `defineInput()` (the stamps ride the input channel); or use `at(time)` with your own time. |
| `room.clock` returns `performance.now()` | The room never called `defineInput()` (the clock rides input acks). |
| Bullet overshoots / tunnels past a target | Point hit test on a fast projectile — use a swept (segment) test. |

---

## API quick reference

| Side | API | Role |
|---|---|---|
| Server | `defineInput(Input, { renderTime, bufferMaxSize })` | Per-client input schema + buffer; render-time stamping |
| Server | `defineInput({ sanitize })` | Per-field `[min, max]` clamps (NaN-safe) or a fix-up callback, applied to every decoded frame before `latest`/buffer visibility |
| Server | `defineInput({ idle })` + `inputs.get(sid).drain()` / `.next()` | Consume frames; the room's `idle: (ctx) => overrides` policy synthesizes one frame on empty ticks (defaults ⊕ overrides; never advances the ack); per-call `{ idle }` overrides, `{ idle: false }` suppresses |
| Server | `setFixedTimestep(step, hz, { subSteps })` | Fixed-step loop; advertises the tick rate (+ optional physics sub-steps per input — §5) |
| Server | `rewind.attachAll(coll, { fields, mode: "snapshot" \| "reckon" })` | Per-attach lag-comp timeline: `reckon` groups rewind to the client's reconstructed sim instant, `snapshot` to the raw stamp |
| Server | `allowRewindState({ maxRewindMs })` + `rewind.attachAll(coll, { fields })` | Record positions on each broadcast (fields a type lacks read live; untracked types read live) |
| Server | `rewind.lastSeenBy(sid)` / `rewind.at(time)` | Rewound view (clamp + live-fallback baked in): `view.value(e, field)`, `view.read(e, fields, out?)` |
| Server | `inputs.get(sid).renderTime` | Raw render time of the last consumed input (prefer `lastSeenBy`) |
| Client | `room.input({ mode })` | Input transport; lag-comp `renderDelay` auto-binds to the `Predict` lerp `delay` when wired through `reconciler`/`sim` (pass `renderDelay` to override) |
| Client | `Predict.get(room, opts)` + `attachAll` / `reconciler` / `sim` | Remote smoothing; local rollback for one flat-field entity (`reconciler`) or composite/engine state (`sim`) |
| Client | `predict.tick(now)` | Per-frame driver: reconcile + decay + smoothing, returns the due fixed-step count for the frame driver's send loop (§4 frame order) |
| Client | `predict.value(e, field)` / `predict.read(e, fields, out?)` | Render reads (one idiom across passive + controller-bound); `read` batches into an object/scratch — mirror of `view.value`/`view.read` |
| Client | `predict.valueAt(e, field, time)` / `predict.readAt(e, fields, time, out?)` | Raw reckoned reads at an instant (sample remotes at `ctx.reckonTime` for hit prediction); `readAt` runs ONE integration per entity |
| Client | `room.clock` | `serverNow()` / `smoothedRtt()` / `lastServerTime()` |
