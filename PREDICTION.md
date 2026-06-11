# Client-side prediction & lag compensation (Colyseus 0.18)

Colyseus 0.18 ships first-class primitives for **server-authoritative simulation
with client-side prediction**: zero-latency local control, smooth remote entities,
and "what you see is what you hit" lag-compensated hits — without hand-rolling a
netcode stack.

This guide puts the **server half** (`defineInput` + `setFixedTimestep` +
`allowRewindState`) next to the **client half** (`room.input` + `Predict` /
`controller`) with the load-bearing rules in one place.

> **Runnable references**
> - `test/prediction/` — hand-rolled platformer (no physics engine).
> - `demos/multiplayer-2d-shooter-prototype/` — Rapier2D physics shooter.
> - `demos/fps-demo/` — 3D FPS (hitscan + capsule hitboxes).

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

  // Per-client input schema (flat primitives only). renderTime:true auto-stamps
  // each input with the client's render time for lag comp.
  input = this.defineInput(MoveInput, { bufferMaxSize: 64, renderTime: true });

  // Records attached entities' positions per tick (auto, after each step).
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
      //      for (const cmd of this.input(sid).drain()) applyInput(p, cmd, ctx.dt);
      //  • one shared solver step for everyone → next() exactly one per tick:
      //      const cmd = this.input(sid).next(); if (cmd) applyInput(p, cmd, ctx.dt);
    }
    // ...advance world, then hit tests (see §6 lag comp).
  }
}
```

- **`defineInput(Input, opts)`** — declares the per-client input schema and buffers
  inbound frames. `renderTime: true` adds a 4-byte render-time stamp per reliable
  input (read it via `input(sid).renderTime`, or — better — `rewind.lastSeenBy(sid)`).
- **`setFixedTimestep(step, hz)`** — framework-owned accumulator loop; each `step`
  advances by the SAME fixed `dt = 1/hz`, and the rate is advertised to clients so
  they predict at the matching `dt`. (Don't also pass `tickRate` to `defineInput`.)
- **`allowRewindState({ maxRewindMs })`** + **`rewind.attachAll(collection, { fields })`** —
  records the numeric `fields` of every entity in the collection once per tick.

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
  bufferMaxSize: 64, renderTime: true,
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
    bufferMaxSize: 64, renderTime: true,
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
  const cmd = this.input(sid).next();   // typed I — never undefined
  ```

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
import { Predict } from "@colyseus/sdk";  // (or the reference predictor)

const predict = Predict.get(room, { mode: "lerp", delay: 100, name: "players" });

// Remote players: render 100ms in the past, interpolated between snapshots.
predict.attachAll("players", { mode: "lerp", fields: ["x", "y"] });

// Local player: server-reconciled prediction. delta:false is mandatory (see §4).
// renderDelay = your interp buffer; the SDK stamps renderTime = serverNow − renderDelay − rtt/2.
const input = room.input({ mode: "reliable", delta: false, renderDelay: 100 });
const me = predict.controller(self, {
  input,
  fields: ["x", "y", "vx", "vy", "grounded"],
  step: (s, cmd) => applyInput(s, cmd, LEVEL),   // SAME function as the server
  smoothing: 15,
});

function frame(now) {
  predict.tick(now);                  // single driver: reconcile + decay + smooth remotes
  const n = me.beginFrame(dtMs);      // how many fixed steps to run now
  for (let i = 0; i < n; i++) me.input(sampleInput());   // predict + buffer + send
  draw(me.value("x"), me.value("y"));                    // smoothed local pose
  for (const [, p] of room.state.players) draw(predict.value(p, "x"), predict.value(p, "y"));
  requestAnimationFrame(frame);
}
```

- **`Predict`** — passive smoothing for entities you DON'T control. Modes:
  `lerp` (interpolate snapshots at `now − delay` — smooth, lagged, faithful),
  `extrapolate` (forecast — live, can overshoot), `damped` (ease toward latest —
  never exact, never jittery), `reckon` (dead-reckon via a step fn).
- **`controller`/reconciler** — active prediction for the entity you DO control.
  Read the smoothed render pose with `value(field)`; read raw predicted state with
  `raw(field)`.
- **`room.clock`** — `serverNow()`, `smoothedRtt()`, `lastServerTime()`. Auto-populated
  from the TIMED prefix that rides input acks — **only when the room called
  `defineInput()`**.

---

## 4. The contract — rules that are load-bearing (and easy to miss)

> ⚠️ **`delta:false` is mandatory for the predicted input channel.** The reconciler
> replays *sent* inputs; with `delta:true` unchanged inputs are dropped, so the
> predicted set ≠ the server-applied set → backward drift.

> ⚠️ **`lastProcessed` is the server's consumed count**, echoed via the TIMED prefix
> — it advances when the server `drain()`s/`next()`s/`clear()`s. Reconcile triggers
> when it advances; there's no seq field to manage.

> ⚠️ **Inputs must be flat primitives** — no nested schemas/collections in the input.

> ⚠️ **Input rate = fixed-step rate = server tick.** Change one, change all. Send one
> input per fixed step (not per render frame).

> ⚠️ **`room.clock` requires `defineInput()`.** Without it the clock is a stub
> (`serverNow()` falls back to `performance.now()`, `rtt`/`lastServerTime` are 0).

> ⚠️ **Lag comp rewinds to the *acting client's* render time, not the server's now.**
> `rewind.lastSeenBy(shooterId)` gets the direction right for you.

---

## 5. Determinism

Prediction matches the server only if both run the **same** simulation:

- **One shared `step`/`applyInput`** function (single source of truth), imported by
  client and server.
- **Identical fixed `dt`** on both sides (`setFixedTimestep` advertises it; the
  controller reads it back).
- **Matching engine versions** for physics (e.g. the same Rapier build client/server).

Divergence shows up as constant small corrections (rubber-banding) even on a LAN; jitter
shows up as occasional corrections that scale with packet loss. See brief 10 for a
determinism diagnostic.

---

## 6. Lag compensation — "what you see is what you hit"

The shooter sees remote targets **interpolated in the past** (`delay`) and **delayed by
the network** (≈ `rtt/2`). To honor their aim, the server rewinds each target to that
moment. Two pieces:

**Client** — tell the server the render time. With `renderTime: true` on the server,
the SDK auto-stamps every reliable input with `serverNow() − renderDelay − rtt/2`
(0 until the clock syncs). Set `renderDelay` to your remote **interp buffer** (the
`Predict` `lerp` delay) — the SDK adds the latency term itself:

```ts
room.input({ mode: "reliable", delta: false, renderDelay: 100 });   // 100 = lerp delay
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

**Keep the two delays equal.** The `Predict` lerp `delay` and the input `renderDelay`
must be the same value (a single shared constant), or the server rewinds to a different
instant than the one on screen. Reverting remotes to `damped` (no fixed delay) silently
breaks the exact match — the rewind then approximates.

### Other recipes

- **Hand-rolled sim** (`test/prediction` platformer) — `applyInput` is plain math;
  `attachAll(enemies, { interpolate: (e) => e.kind === "teleporter" ? "step" : "linear" })`
  keeps teleport snaps sharp under rewind.
- **Physics sim** (`2d-shooter`) — bridge Rapier into the controller's scalar step;
  consume one input per tick with `next()` and `world.step()` once.
- **Remote smoothing** — `lerp` for players (faithful), `reckon` for AI you can
  forward-simulate, `damped` for "never jittery" cosmetic entities.
- **Projectiles** — predict the shooter's own shot on fire for zero-latency feedback;
  age incoming projectiles by `serverNow() − spawnTime` (lag-invariant); sweep
  client-side hit checks so fast projectiles don't tunnel.

---

## 7. Troubleshooting

| Symptom | Likely cause |
|---|---|
| Local player rubber-bands constantly | Non-determinism: different `dt`, divergent `step`, or engine-version mismatch (§5). |
| Remotes stutter / teleport | Interp `delay` too small (buffer underruns); raise it past 1–2 patch intervals, or check patch rate. |
| "I hit them but no damage" on moving targets | Not rewinding (or rewinding to server-now). Use `rewind.lastSeenBy(shooterId)` (§6). |
| Hits land slightly ahead of the crosshair | `MAX_REWIND_MS` too small — it truncates the real rewind (`renderDelay + RTT + a tick`); raise it. |
| `rewind.lastSeenBy` throws | The room didn't enable `defineInput({ renderTime: true })`; or use `at(time)` with your own time. |
| `room.clock` returns `performance.now()` | The room never called `defineInput()` (the clock rides input acks). |
| Bullet overshoots / tunnels past a target | Point hit test on a fast projectile — use a swept (segment) test. |

---

## API quick reference

| Side | API | Role |
|---|---|---|
| Server | `defineInput(Input, { renderTime, bufferMaxSize })` | Per-client input schema + buffer; render-time stamping |
| Server | `defineInput({ sanitize })` | Per-field `[min, max]` clamps (NaN-safe) or a fix-up callback, applied to every decoded frame before `latest`/buffer visibility |
| Server | `defineInput({ idle })` + `input(sid).drain()` / `.next()` | Consume frames; the room's `idle: (ctx) => overrides` policy synthesizes one frame on empty ticks (defaults ⊕ overrides; never advances the ack); per-call `{ idle }` overrides, `{ idle: false }` suppresses |
| Server | `setFixedTimestep(step, hz)` | Fixed-step loop; advertises the tick rate |
| Server | `allowRewindState({ maxRewindMs })` + `rewind.attachAll(coll, { fields })` | Record positions per tick |
| Server | `rewind.lastSeenBy(sid)` / `rewind.at(time)` | Rewound view (clamp + live-fallback baked in): `view.value(e, field)`, `view.read(e, fields, out?)` |
| Server | `input(sid).renderTime` | Raw render time of the last consumed input (prefer `lastSeenBy`) |
| Client | `room.input({ mode, delta:false, renderDelay })` | Input transport; `renderDelay` = your interp buffer |
| Client | `Predict.get(room, opts)` + `attachAll` / `controller` | Remote smoothing + local reconciliation |
| Client | `room.clock` | `serverNow()` / `smoothedRtt()` / `lastServerTime()` |
