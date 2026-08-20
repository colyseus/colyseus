# Changelog

## 0.18.2

- The smoothing rate options — `damping` (lerp/extrapolate/damped) and `smoothing` (reckon, `reconciler`, `sim`, `spawns`) — are unified as a single `smoothMs`, now in **milliseconds** (time constant; 0 = off) instead of an opaque per-second rate. Roughly the extra display lag smoothing adds: a steady mover renders `speed × smoothMs` behind, and corrections fade ~63% per `smoothMs`. Convert old values with `smoothMs = 1000 / old` (damping 15 → 65, smoothing 20 → 50). The default is 50 everywhere it applies.
- `mode: "lerp"` now honors `smoothMs` as an optional output spring on the interpolated result (default 0 — output unchanged). Arming it (25–65) keeps rendered velocity continuous when the snapshot stream itself is imperfect, at the cost of the drawn position trailing the hit position by ≈ `speed × smoothMs` during motion — display-only, rewind still reads the unsmoothed interpolation.
- Apply `@unreliable` state patches arriving over WebTransport datagrams. Each carries a sequence number; a reordered frame is dropped instead of applied, so a late packet can't write a stale value over a newer one.
- Lag compensation now works with `room.input({ mode: "unreliable" })`. Unreliable inputs previously carried no `renderTime`/`reckonTime` stamp — the stamp was delta-coded against a running baseline that can't survive loss — so a room using `allowRewindState()` silently read those clients at live positions. Each packet now carries a self-contained stamp block, one per ring slot, so an input recovered redundantly from a later packet still arrives with the instant it was sampled at. `mode` is purely a delivery choice again. One constraint comes with it: `allowRewind` gates the reliable channel only — an unreliable packet stamps its whole redundancy ring or none of it, so per-input exclusion would cost bandwidth rather than save it. Setting it on an unreliable handle warns once.
- Fix `mode: "unreliable"` traffic being discarded on WebSocket transports. `sendUnreliable()` warned and dropped, so every unreliable input and `request({ mode: "unreliable" })` was silently lost — the server never saw them and the client's pending set grew without bound. It now falls back to the reliable channel (what callers already assumed), warning once. Real datagram delivery still needs `@colyseus/h3-transport` (WebTransport), which is experimental.

## 0.18.1

0.18 preview refresh — ships the client-side prediction library. Experimental surfaces may still change before 0.18 stable. **Compat:** rooms that use `defineInput()` changed wire format — upgrade `@colyseus/core` to 0.18.1 alongside. This release also brings in the 0.17.42 / 0.17.43 fixes (H3 frame reassembly, `getLatency()` hang — see their sections below), which the published 0.18.0 predates.

### Experimental: client-side prediction — `@colyseus/sdk/predict`

New library for responsive movement on authoritative servers. Get a per-room instance with `Predict.get(room, opts?)`:

- **Remote-entity smoothing** — `predict.attach(instance, { fields, … })` / `predict.attachAll(key, config)` render remote entities on the server-time axis (jitter-immune). Per-field modes: `"lerp"` (default; `delay`, `damping`, `maxExtrapolate`, `snap`, shortest-arc `angle`), `"extrapolate"`, `"damped"`, `"reckon"` (forward dead-reckoning with `smoothing` / `substep`), or `"raw"`. `setDefaults(opts)` sets the room-wide baseline.
- **Local rollback (flat state)** — `predict.reconciler(instance, { input, step, fields?, smoothing?, snap?, … })` predicts your own schema instance and reconciles against server truth at each ack. `fields` is optional — every scalar field is derived from the schema. Reconciliation is wire-precision-aware (corrections that are wire-indistinguishable from the prediction are skipped, so lossy wire types like `float32` don't cause phantom mispredicts). `snap` sets a teleport threshold: past it the correction pops instead of decaying. `warnOnDivergence` flags non-determinism in dev.
- **Local rollback (sim worlds)** — `predict.sim({ input, world, step, adopt?, pose?, interpolate? })` rolls back a full physics world. Decoded schema entries auto-bind into the world; `step` is `(ctx, world, command)`, aligned with the reconciler's `(ctx, state, command)`.
- **One send idiom** — `predict.tick(now)` owns the room-wide fixed-step accumulator and returns the number of input steps due this frame; the frame driver (earliest per-frame callback) mutates `input.data` and calls `input.send()` once per step. Everything downstream only reads.
- **Reads** — `predict.value(instance, field)` (smoothed display value), batch `predict.read(instance, fields, out?)` / `predict.readAt(instance, fields, time, out?)` (one integration per instance), `predict.valueAt(instance, field, time)` for lag-comp aiming on a specific timeline instant.
- **Optimistic events** — `predict.defineEvent({ …, confirmOn? })` returns a typed `PredictedEventChannel`: fire from the predicted step via `ctx.predict(channel, payload)`, replay-safe across rollbacks. Declarative `confirmOn` bindings settle predictions against server truth: field-flip (`{ collection, field, equals }`), `{ event: "add", mine? }` (keyless), or `{ event: "remove" }`; `onUnpredicted` fires for server events never predicted locally. Unconfirmed predictions expire after `DEFAULT_GRACE_TICKS = 10`.
- **Predicted spawns** — `predict.spawns(key, opts?)` correlates locally predicted spawns with their server counterparts (handoff without a visual gap).
- **Step context** — step callbacks receive `ctx`: `{ dt, dtMs, tick, subSteps, subDt, subDtMs, isReplay, reckonTime, lagCompActive }`, plus `ctx.memo(compute)` for rollback-safe cached values and `ctx.predict(channel, payload)`. Use `!ctx.isReplay` to gate presentation side-effects.
- **Dev diagnostics** (all dev-only, warn-once): divergence telemetry, memo-collision detection, render reads between `predict.tick()` and the frame's sends, and writes to unknown fields on `input.data`.

### Experimental: input handle (**breaking** vs 0.18.0)

- `room.input(options?)` is memoized per room — the first call's options win; later calls with differing options warn once and are ignored.
- **Breaking:** the `delta` option is gone — inputs are always delta-encoded. Every `.send()` transmits exactly one input (a body-less frame when nothing changed, decoded server-side as a no-op holding the last values); to skip a tick, don't call `.send()`.
- The handle surface grew beyond `.data` / `.send()` / `.reset()` / `.mode`:
  - `send()` returns the assigned seq; `onSend(listener)` observes sends.
  - Acks & buffers: `lastProcessed` (server-acked seq), `sentCount`, `pendingCount`, `replayBufferSize`, `at(seq)`, `reckonTimeAt(seq)`.
  - Server-declared timing from the handshake: `tickRate` / `stepSeconds` / `stepMs`, `patchRate`, `subSteps` / `subStepSeconds` / `subStepMs`.
  - `epoch` — monotonic reset counter. `reset()` bumps it; reconnects auto-reset (the server restarts its input buffer) and rollback controllers auto-follow, so no reconnect wiring is needed.
  - `allowRewind: (data) => boolean` option — per-input gate for the lag-comp timeline stamp (e.g. only stamp frames that actually fire).

### `room.clock`

- Rooms with `defineInput()` get a real `RoomClock`: `now()` (local monotonic), `serverNow()` (estimated server clock, ms since room start), `renderNow()` (slew-limited render timeline — guaranteed present), `rtt()` / `smoothedRtt()` / `jitter()`, `lastServerTime()`. Powered by the TIMED wire prefix — no schema cooperation needed.

### Reconnect resync

- A full-state message on a **rejoin** now reconciles the existing decoded tree via `decodeResync` instead of decoding additively into it — entries removed while the client was offline are pruned, and object identity is preserved for everything that survived. First joins are unchanged. Requires `@colyseus/schema ^5.0.8`; degrades gracefully to additive decode on older schema versions.

### Debug tooling

- Network-condition simulation: latency (RTT) + jitter sliders with one-tap presets (Off / Low / Med / Large), and a `__net(delay?, jitter?)` console API. Jittered delivery preserves message order; `onclose` is delayed until pending `onmessage` callbacks fire under jitter-only simulation.
- Auth token section in the dev-tools menu: preview/copy the current token, or clear a stale one that fails `onAuth` (e.g. switching projects on the same origin).

### Performance

- The prebuilt `dist/` bundles are now minified, and server-only `@colyseus/schema` exports are tree-shaken out of the browser bundle: `colyseus.js` is ~58 KB gzipped (was ~191 KB shipped unminified).

## 0.18.0

### Experimental: typed binary client→server input

> **Status: experimental.** API surface and wire format may change before 0.18 stable. Feedback welcome.

- New: `conn.input(options?)` returns a cached per-room `ClientInputHandle<I>`:
  - `.data` — mutable schema instance; mutate, then call `.send()`
  - `.send()` — encodes via `InputEncoder` and routes to reliable or unreliable channel based on `mode`
  - `.reset()` — drops the unreliable ring buffer; re-marks every populated field as dirty in delta mode
  - `.mode` — read-only wire mode

  Schema discovery, in order:
  1. `options.type` — explicit constructor (always works).
  2. Server-sent reflection from the JOIN handshake — the SDK reconstructs the input class via `Reflection.decode` and `Reflection.makeEncodable` (requires `@colyseus/schema@^5.0.3`). The synthesized class has the same fields as the server's input schema; `instanceof YourInput` won't pass on it.
- Recommended for rollback netcode: `{ mode: "unreliable", delta: true, historySize: 4 }` — small redundant deltas, idempotent across drops via absolute-value wire ops.
- Generics intentionally unconstrained (`<I = any>`) so user input classes coming from a different copy of `@colyseus/schema` (multi-version installs) still type-check. Runtime is duck-typed via the encoder.
- Handshake: SDK now parses tagged sections trailing the existing JOIN_ROOM payload (`[tag (uint8)][length (varint)][payload]`); unknown tags are skipped via length, so future sections are forward-compatible.
- **Breaking:** the previously unreleased `room.setInput(instance, options?)` / `room.flushInput()` / `get input()` API is gone. Migrate to `conn.input(...)`.

### Other

- Bump `@colyseus/schema` to `^5.0.3` (required for `Reflection.makeEncodable`).

## 0.17.43

- Fix `client.getLatency()` (and therefore `Client.selectByLatency()`) hanging on unresponsive endpoints. The measurement only settled on a pong or `onerror`, so a server that closed the socket cleanly without replying (only `onclose` fires) left the promise pending forever, and a blackholed/filtered host stalled until the OS-level TCP timeout. `getLatency()` now also rejects on `onclose` and on a configurable `timeout` (`LatencyOptions.timeout`, default `1500`ms, also forwarded through `selectByLatency()`), so a single wedged endpoint can no longer stall the whole selection. Closes [#941](https://github.com/colyseus/colyseus/issues/941) — thanks @TJEvans for reporting!

## 0.17.42

- Fix `H3Transport` frame reassembly: a single WebTransport `reader.read()` is not guaranteed to land on a frame boundary, so chunks ending mid-payload or mid-varint-prefix caused sporadic handshake failures and `ROOM_STATE_PATCH` decode errors on rooms with larger initial state. The reader now buffers partial data across reads and only dispatches complete length-prefixed frames. Closes [#934](https://github.com/colyseus/colyseus/pull/934) — thanks @anaibol for reporting and contributing the initial fix!

## 0.17.41

- Isolate `debug.js` panel inside a Shadow DOM root so page-level CSS (e.g. a global `canvas { width: 100vw }` rule) can no longer stretch or restyle the debug UI.

## 0.17.40

- Fix `client.http.*` type inference wrongly requiring `query` and `params` on endpoints that declared neither (most visible under `strictNullChecks: false`). Closes [#933](https://github.com/colyseus/colyseus/issues/933) - thanks @thedomeffm for reporting!

## 0.17.39

- Allow swapping the `fetch` implementation via `fetchFn` option in `ClientOptions`. Automatically falls back to `XMLHttpRequest` when `fetch` is unavailable (e.g. Cocos Creator Native). Closes [#931](https://github.com/colyseus/colyseus/issues/931) - thanks @liangpei-web for reporting!

## 0.17.38

- Fix HTTP response content-type detection using `indexOf()` instead of `includes()`, which caused non-JSON responses to be incorrectly parsed as JSON

## 0.17.37

- Fix `debug.js` "refId not found" schema decoder errors when connection closes while latency simulation is enabled. The `onclose` handler is now delayed to fire after all pending `onmessage` callbacks.

## 0.17.36

- Fix `debug.js` panel ID collision when the same `sessionId` is reused across rooms (e.g. QueueRoom handoff).

## 0.17.35

- Add `room.reconnection.enabled` flag. Use `sessionStorage` instead of `localStorage` to determine if "debug" panel is hidden.

## 0.17.34

- Bundle `dist/colyseus.js` file with latest `@colyseus/schema` version.

## 0.17.33

- Fix `debug.js` panel to intercept all `consumeSeatReservation()` calls.

## 0.17.32

- Fix `debug.js` panel text color. (#910, thanks @Andrek25)

## 0.17.31

- Fix `debug.js` panel text color. (#909, thanks @Andrek25)

## 0.17.30

- Throw error if requesting to join a room without a room name.
- Fix `e.code` of `client.http.*` errors to always be a number.

## 0.17.29

- Fix `dist/debug.js` build to be embedded via CDN (e.g. `https://unpkg.com/@colyseus/sdk@^0.17.0/dist/debug.js`)

## 0.17.28

- fix displaying correct error message on `ServerError` / `MatchMakeError`

## 0.17.27

- Fix forwarding `?skipHandshake=1` query param if concrete state has been provided.

