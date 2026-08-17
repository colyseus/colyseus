# Changelog

## Unreleased

- New `beforeUpgrade` transport option, called before the WebSocket handshake with the incoming `Request` and the same read-only context `onAuth()` receives. Return a `Response` to answer the request instead of upgrading it. Supported by `@colyseus/ws-transport`, `@colyseus/uwebsockets-transport` and `@colyseus/bun-websockets`; WebTransport has no handshake to intercept, so `@colyseus/h3-transport` warns and ignores it. (thanks @mikkas70 for the proposal and @Br1an67 for the first pass - https://github.com/colyseus/colyseus/issues/912)

- `context.ip` is now a single address on every transport, resolved the same way everywhere: `x-real-ip`, then the first entry of `x-forwarded-for`, then `x-client-ip`, then the address of the connection. It previously varied per transport, could be a `string[]`, and returned the entire `x-forwarded-for` proxy chain. It is `undefined` when no source provides one.

- Fix `context.headers` not being a `Headers` instance under `@colyseus/uwebsockets-transport`, where it was a plain object. `context.headers.get()` threw in `onAuth()` on that transport only.

- `context.headers` is now built on first read instead of on every connection, so a room that never reads it pays nothing. Connection setup on `@colyseus/ws-transport` is ~2.2µs cheaper as a result.

- `allowRewindState()` now lag-compensates clients sending `input({ mode: "unreliable" })`. `decodeUnreliable()` previously ignored the TIMED modifier and captured every input with a zero stamp, so those clients were always read live. It now parses the per-slot stamp block the SDK sends and pairs it with the ring's slots; a packet without the modifier still reads live, so older clients are unaffected.

- Schema fields marked `@unreliable` now sync over the transport's unreliable channel (a WebTransport datagram) instead of the state patch, so a dropped frame costs one stale value instead of stalling the ordered stream behind a retransmit. They flush with each `broadcastPatch()` by default; set `room.unreliablePatchRate` to give them their own cadence — 60Hz movement over a 20Hz `patchRate`. Needs a transport with a datagram channel — today only `@colyseus/h3-transport` (WebTransport), which is experimental; on WebSocket transports those fields keep their join-time value and the room warns once.

  A faster `unreliablePatchRate` has a known cost: entity ADDs ride the reliable channel, so datagrams sent between patches can name a refId the client hasn't received yet. The client skips those frames — state can't desync, since `@unreliable` is primitives-only — but each logs `"refId" not found` and that entity's first value arrives one mutation later. Leaving `unreliablePatchRate` unset avoids it entirely.

- Fix `gracefullyShutdown()` returning before every room's async `onDispose()` had finished, tearing down presence/driver (and exiting the process) while rooms were still writing. `matchMaker.stats.local.roomCount` is decremented when a room *starts* disposing, so with several rooms shutting down at once the first one to finish released the whole shutdown. A room that was already mid-dispose when shutdown began was also not waited on at all. (thanks @hunkydoryrepair for reporting - https://github.com/colyseus/colyseus/issues/823)

## 0.18.4

Brings in the 0.17.48 and 0.17.50 fixes.

- Fix reconnection being killed right after succeeding when `onDrop` `await`s `allowReconnection()` and the server never saw the old connection close. As reported: a page refresh behind a proxy that discards in-flight data on disconnect (swallowing the client's WS close frame — observed on Render.com) leaves the server believing the old connection is still alive; a page refresh on localhost doesn't trigger it because the close frame reaches the server. When the reconnect request arrived in that state, `checkReconnectionToken()` force-closed the stale client and deferred `client.leave(4002)` until `_onLeave` resolved — but with an awaited `allowReconnection()`, `_onLeave` resolves only *after* the successful reconnection has transplanted the new socket into `client.ref`, so the deferred `leave()` closed the freshly reconnected socket (`onDrop 4002 → onReconnect → onDrop 4002 → onLeave 4002`, with the client burning its retry budget against a dead session). The deferred `leave()` is now skipped when the client's `ref` has been transplanted by a successful reconnection. Regression test under "Auto-reconnection" in `bundles/colyseus/test/RoomReconnection.test.ts` — no proxy needed: calling `reconnect()` while the old connection is still open creates the same server-side state. (thanks @ehart004 for the detailed diagnosis - https://github.com/colyseus/colyseus/issues/950)
- Fix `matchMaker.stats.local.ccu` drifting negative when `onDrop()` `await`s `allowReconnection()`: a late-resuming `_onLeave()` held the replacement's `reconnectionToken` and registered a second leave for one join. The `RECONNECTED` guard now runs before the `_reconnections` lookup.
- Fix crash on a non-JSON `POST /matchmake/*` body: `JSON.parse` threw inside the request stream's `"end"` listener in the raw Node adapter (`router/node.ts`, used by `colyseus/vite`), escaping as an `uncaughtException`. Now replies `400`, and the body is capped at 1MB (`413`).
- Malformed body on the default router replies `400` instead of `500` with a stack trace on stderr.
- Fix JSDoc `@param` names that did not match the actual arguments, which reach users through editor tooltips and the generated docs: `Room.allowReconnection()` documented `client` (the parameter is `previousClient`), and `matchMaker.findOneRoomAvailable()` documented `sortOptions` — the parameter is `additionalSortOptions`, and `sortOptions` is a different value inside the function (the room handler's defaults, with the argument merged over them). (thanks @darkdi for the fix - https://github.com/colyseus/colyseus/pull/953)
- Fix message types and room names that collide with `Object.prototype` keys (`__proto__`, `constructor`, `toString`, `valueOf`, `hasOwnProperty`, …) resolving to inherited members on the plain objects used as dispatch registries. Four symptoms: `onMessage("constructor", cb)` threw at registration (`this.events[event].push is not a function`), so the room failed to be created at all; an incoming message of such a type false-positived the per-type validator lookup, threw inside `standardValidate()` and disconnected the sender with `WITH_ERROR` instead of reaching the registered handler or the `'*'` catch-all; a `room.request()` of such a type was answered with `ERROR` for the same reason; and matchmaking against such a room name surfaced `handler.getFilterOptions is not a function` instead of `MATCHMAKE_NO_HANDLER`. The handler, validator and room-handler registries are now null-prototype objects, so these names behave like any other. Regression tests under "message types colliding with Object.prototype keys" (`Integration.test.ts`) and "room names colliding with Object.prototype keys" (`MatchMaker.test.ts`). Note that the process-killing variant reported against 0.16 does not apply here: 0.16 indexed `onMessageHandlers` directly and called `.callback` on the inherited value, throwing an uncaught exception outside dispatch. (thanks @BestOlumese for the report and repro - https://github.com/colyseus/colyseus/issues/951)
- Fix `matchMaker.remoteRoomCall()` return type resolving to a union of every room member instead of the selected method's return type. The method name is now captured as a literal type parameter, so `remoteRoomCall(roomId, 'myMethod')` (types inferred) and `remoteRoomCall<MyRoom, 'myMethod'>(roomId, 'myMethod')` (both type arguments given) resolve to the method's awaited return type — or the property's type when accessing an attribute. Note that `remoteRoomCall<MyRoom>(roomId, 'myMethod')` with *only* the room type given cannot be made precise: TypeScript applies the method parameter's default instead of inferring the literal once an explicit type argument list is present (microsoft/TypeScript#26242) — that call style now resolves to `any` rather than the previous member-union noise; pass both type arguments for a precise result. A fallback overload keeps dynamic method names (not present on the room type — e.g. rooms defined via `defineRoomType()`, or private methods) compiling as before, typed `any`. (thanks @ColaFanta for reporting - https://github.com/colyseus/colyseus/issues/952)
- Typing tests are now normalized on vitest typecheck mode (`test/*.test-d.ts` with `expectTypeOf`): the compile-only strict-declarations suite in `@colyseus/core` was converted from an ad-hoc `tsc -p` script, and `@colyseus/shared-types` now actually enforces its existing type assertions (`expectTypeOf` is a runtime no-op unless typecheck mode is enabled). Internal only — no published API change.

## 0.18.3

Brings in the 0.17.47 fix, which the published 0.18.2 predates.

- Fix `TS2883` / `TS2742` ("The inferred type of ... cannot be named without a reference to `StandardSchemaV1` ... This is likely not portable") when emitting declarations for code that calls `createEndpoint()`. The inferred return type expands to a structure naming `StandardSchemaV1`, which is declared inside `@colyseus/better-call` — a package consumers do not depend on directly, and which under pnpm's isolated `node_modules` is only reachable through `.pnpm/…`. TypeScript therefore refuses to emit the reference. `@colyseus/core` now re-exports every `@colyseus/better-call` type reachable from an inferred type: `StandardSchemaV1`, `MiddlewareOptions`, `MiddlewareInputContext`, `CookieOptions`, `CookiePrefixOptions` and `Status`. (thanks @ColaFanta for reporting - https://github.com/colyseus/colyseus/issues/949)
- The same error also affected `createMiddleware()`, `createRouter()` and endpoints using `ctx.setCookie()`. Only isolated `node_modules` layouts (pnpm) were affected — npm/yarn hoisting makes `@colyseus/better-call` reachable from the project root, which is why this went unnoticed. No runtime or public API change: the added exports are type-only, and they live on `@colyseus/core/router/index` rather than the package root so the top-level API surface is unchanged.

## 0.18.2

Brings in the 0.17.46 fix (Express v4 crash on `listen()` when the app has no routes registered — see its section below), which the published 0.18.1 predates.

## 0.18.1

0.18 preview refresh — the server side of the client-prediction stack. Experimental surfaces below may still change before 0.18 stable. **Compat:** rooms that call `defineInput()` changed wire format — upgrade `@colyseus/sdk` to 0.18.1 alongside. This release also brings in the 0.17.43 / 0.17.44 fixes (`Server.serverless()`, Redis auto-config on Colyseus Cloud — see their sections below), which the published 0.18.0 predates.

### Experimental: fixed timestep (**breaking** — replaces `setTickedSimulation`)

- `Room.setTickedSimulation(cb, delay?, startTick?)` and the `room.tick` getter are gone, split into two explicit APIs:
  - `setTimestep(cb, delay?)` — variable timestep, callback receives the measured `deltaTime`. (Rename of `setSimulationInterval()`, which stays as a deprecated alias.)
  - `setFixedTimestep(step, tickRate = 60, opts?)` — framework-owned fixed-step accumulator for deterministic simulation / rollback. The callback receives a `StepContext`: `{ dt, dtMs, tick, subSteps, subDt, subDtMs }`. Catch-up is capped at 5 steps per wake — a stalled event loop drops backlog instead of spiraling.
- Physics sub-steps: `subSteps` (on `setFixedTimestep` or `defineInput`) decouples the physics rate from the input/network rate — each fixed step integrates `subSteps` engine sub-steps of `dt / subSteps`, identically on client and server (`ctx.subDt` / `ctx.subDtMs`).
- `SimulationIntervalException` renamed to `TimestepException` (deprecated alias kept).

### Experimental: input (**breaking** — accessor rework)

- `defineInput()`'s return is now assigned to `room.inputs` (was `input`); the per-client accessor is `room.inputs.get(sessionId)`. The API object also exposes the declared step (`tickRate` / `stepSeconds` / `stepMs`, `subSteps` / `subStepSeconds` / `subStepMs`).
- The accessor was redesigned around explicit consumption (was `.latest` / `.at` / `.drain` / `.peek` / `.size` / `.clear`):
  - `consume(opts?)` — one-at-a-time iterator (also `[Symbol.iterator]`), advancing the reconcile ack as you go; `next(opts?)` — oldest single input; `take(n)`; `drain(opts?)` — all + clear; `peek()` — read without consuming.
  - `latest`, `at(seq)`, `size`, `clear()` remain.
  - New reads: `consumedCount` (the ack the SDK reconciles against), `wasIdle`, `renderTime` / `reckonTime` (lag-comp timeline stamps of the last consumed input).
- `seqField` is now opt-in (no `"seq"` default) and only powers `.at()` lookup and reliable-channel dedupe. Unreliable dedupe uses a framework-owned wire sequence over the redundancy ring — rollback input needs zero schema ceremony.
- New `defineInput()` options:
  - `sanitize` — per-field `[min, max]` clamp map or `(input) => void` function; never trust the wire.
  - `idle` — synthesized input for quiet/absent clients: `true` (reuse latest), a `Partial<I>`, or `(ctx) => …`; also per-call via `next({ idle })` / `consume({ idle })`.
  - `tickRate` / `stepMs` / `stepSeconds` and `subSteps` — the declared step, advertised to the SDK in the JOIN handshake (`HandshakeSection.INPUT_OPTIONS`: tick rate, patch rate, sub-steps, lag-comp timeline flags).

### Experimental: lag compensation

- New `Room.allowRewindState(opts?)` returns a per-room `Rewind` recorder for validating hits at what the client actually saw:
  - `rewind.attachAll(collection, { fields, mode?, interpolate?, maxRewindMs? })` / `rewind.attach(instance, …)` — record numeric fields per entity. `mode: "snapshot"` (default) rewinds to the client's interpolated render time; `mode: "reckon"` rewinds to the client's forward-reckoned display time (its serverNow estimate, stamped directly on inputs, so the rewind read is immune to RTT-estimation error).
  - `rewind.lastSeenBy(sessionId)` / `rewind.at(time)` return a `RewindView` with `.value(entity, field)` and batch `.read(entity, fields, out?)`; one-off `rewind.valueAt(instance, time, field)`.
  - Recording is automatic on every broadcast patch, stamped with the same server-time the frame carries — display and rewind agree even when `patchRate` ≠ timestep. Manual `record(now)` during a tick supersedes that tick's auto-record.
- Input timeline stamps are delta-coded on the wire (≈1 byte/frame); the SDK gates them per-input via `room.input({ allowRewind })`.

### Experimental: request/response replies

`room.request()` (client → server with a reply, shipped undocumented in 0.18.0) matured:

- Message handlers now receive an optional 3rd argument, `ctx: MessageContext` — existing 2-arg handlers are unaffected. `ctx.id` is the request id (`undefined` for fire-and-forget), and `return ctx.resolve(value)` / `return ctx.reject(reason)` are typed reply arms: the SDK's `room.request()` promise resolves/rejects accordingly, with the reject reason type inferred (`ExtractRejectReason`).
- A plain return value is still the response payload (`ExtractResponseType` now subtracts the reply arms); thrown errors reply `ERROR`.
- Synchronous handlers reply in the same tick (no microtask deferral).

### TIMED protocol

- New `ProtocolModifier.TIMED` envelope bit: rooms that called `defineInput()` prepend server-time + per-recipient last-input-ack timestamps to `ROOM_STATE` / `ROOM_STATE_PATCH`, giving the SDK RTT / server-clock / offset estimation with no application-level schema cooperation.

### Performance

- `broadcast(..., { afterNextPatch: true })` no longer keeps a per-client queue: non-timed rooms fan out one shared buffer right after the patch; timed rooms stage per-client frames flushed via a dirty list (no full client scan per patch).

### Security

- better-call's `/api/reference` OpenAPI page is **disabled by default** — it dumps the full API surface unauthenticated. Opt back in by passing `openapi` to `createRouter(endpoints, config)`, optionally guarded with the `basicAuth()` middleware.

### Other

- New: `clients.get(sessionId)` — canonical O(1) session lookup, mirroring `inputs.get(sessionId)`. `clients.getById()` is deprecated.
- New exports: `Rewind` / `RewindView` / `RewindOptions` / `RewindMode`, `StepContext` / `FixedTimestepCallback` / `SimulationCallback`, `TimestepException`, input types (`DefineInputOptions`, `InputAPI`, `InputAccessor`, `ConsumeOptions`, `IdleInput`, `SanitizeInput`, …), `MessageContext` / `Rejection` / `Resolution` / `ExtractResponseType` / `ExtractRejectReason`, `ProtocolModifier`, and `enqueueClientRaw` (raw-send queueing centralized here; used by the 0.18.1 transports).
- Fix: `OnMessageException` now carries the correct `type` / `payload` across all dispatch paths.
- Require `@colyseus/schema` `^5.0.8` — monotonic refIds + `decodeResync` for the SDK's reconnect resync.

## 0.18.0

### Experimental: typed binary client→server input

> **Status: experimental.** API surface and wire format may change before 0.18 stable. Feedback welcome.

- New: `Room.defineInput(InputClass, opts?)` — declare the per-client input schema. Returns a callable accessor; assign it to the room's `input` field. `opts` accepts `{ seqField?, bufferMaxSize? }` (defaults: `seqField: "seq"`, `bufferMaxSize: 32`). The framework allocates one input instance + `InputDecoder` per joining client and dedupes redundant unreliable frames via `seqField` when present.
- New: `room.input(sessionId)` returns a per-client `InputAccessor` with:
  - `.latest` — bound schema instance, mutated in place by the decoder (cheapest read)
  - `.at(seq)` — buffered snapshot whose `[seqField]` matches `seq` (rollback / lockstep)
  - `.drain()` / `.peek()` — buffered snapshots oldest → newest
  - `.size` / `.clear()`
  - Returns a frozen no-op accessor for unknown sessionIds and for rooms that didn't call `defineInput()`.
- New: `Room.setTickedSimulation(callback, delay?, startTick?)` — fixed-rate simulation that passes `(tick, deltaTime)` to the callback.
- New: `room.tick` — current simulation tick getter (incremented after each `setTickedSimulation` callback returns). **Breaking:** subclasses with a user-defined `tick()` method must rename to avoid the accessor/method override clash.
- New: `Protocol.ROOM_INPUT_RELIABLE` and `Protocol.ROOM_INPUT_UNRELIABLE` wire bytes routed to the per-client `InputDecoder`. Unreliable mode supports framed ring redundancy.
- New: `ClientArray.getById(sessionId)` — O(1) lookup for the per-tick hot path. Existing mutating methods (`push` / `splice` / `pop` / `shift` / `unshift` / `delete`) keep the secondary index in sync.
- Handshake: when `defineInput()` was called, the JOIN_ROOM payload now carries the input schema's `Reflection.encode(...)` bytes as a tagged section (`HandshakeSection.INPUT_REFLECTION`). Cached once per input ctor via a module-level `WeakMap`.
- Generics on the input feature are intentionally unconstrained (`new () => any`, no `extends Schema`) so user input classes from a different copy of `@colyseus/schema` (multi-version installs) still type-check.

### Other

- Bump `@colyseus/schema` to `^5.0.3` (required for input-reflection auto-discovery on the SDK side via `Reflection.makeEncodable`).
- Remove deprecated `Client#id` property. Use `Client#sessionId` instead.
## 0.17.46

- Fix crash on `listen()` when using Express v4 with an app that has no routes registered. Detecting whether the app already handles `/` read `app._router` and fell back to `app.router` — but on Express v4 `_router` is only created once the first route/middleware is registered, and reading `app.router` throws `'app.router' is deprecated!`. Registering any route (e.g. `app.use("/", ...)`) masked it, which is why it only surfaced on an otherwise empty `app.config.ts`. Express v5 was unaffected. (thanks m.ilan on Discord for reporting)
- Root route detection no longer reports "a root route exists" when the Express app exposes no router stack, which would have suppressed the default `Colyseus <version>` response on `/`.

## 0.17.45

- Fix published type declarations for strict TypeScript consumers (`strict: true` + `skipLibCheck: false` under NodeNext resolution): `RoomExceptions` no longer applies `Parameters<>` to the optional lifecycle hooks, and `LocalPresence.subscriptions` no longer leaks an inferred `EventEmitter<[never]>` type that rejected every `.on()`/`.emit()` call. (thanks @Hoodgail for the fix - https://github.com/colyseus/colyseus/pull/947)
- Type-level: the `room()` helper generic is now constrained to `RoomOptions`, matching the existing `Room<T>` class constraint. Explicit type arguments incompatible with `RoomOptions` (already rejected by `Room<T>`) now error at the call site.
- Add a compile-only regression test (`pnpm --filter @colyseus/core test`) that type-checks the built declarations as a strict NodeNext consumer.

## 0.17.44

- Add `Server.serverless()`: prepares matchmaking + HTTP routes and returns the underlying `http.Server` **without** binding to a port — for serverless platforms that consume an exported server instead of a listening one (e.g. Vercel, whose Express/Hono WebSocket examples use `export default server`). Calling `listen()` on those platforms selects their "captured server" path, which does not invoke Express-style app handlers. Pass an `http.Server` to the transport so it can be exported:
  ```ts
  import { createServer } from "node:http";
  const httpServer = createServer();
  const gameServer = new Server({
    transport: new WebSocketTransport({ server: httpServer }),
    express: (app) => { app.get("/hello", (req, res) => res.json({ ok: true })); },
  });
  gameServer.define("my_room", MyRoom);
  export default await gameServer.serverless(); // no listen()
  ```
  (On Vercel, also set `package.json` `"main"` to the entrypoint file.)
- `serverless()` pre-reads request bodies into `req.body` so matchmaking `POST`s work when the server is consumed via `export default` (the router otherwise reads from a lazy request stream that does not drain in that mode). Added `prereadRequestBodies()` to `router/node.ts`.
- Internal: `listen()` and `serverless()` now share a private `bindRoutes()` helper (set transport + bind matchmaking routes). `listen()` behavior is unchanged.

## 0.17.43

- Fix `defineServer()` + `server.listen()` not configuring `RedisDriver` / `RedisPresence` on Colyseus Cloud. The `Server` constructor was pre-instantiating `LocalPresence` / `LocalDriver`, shadowing the cloud auto-detection in `matchMaker.setup()` (`utils/Env.ts`). Now passes `options.presence` / `options.driver` through as-is so `getDefaultPresence` / `getDefaultDriver` can pick Redis when running on Cloud.
- `Env.ts` `getDefaultPresence` / `getDefaultDriver` now gate Redis selection on `os.cpus().length > 1 || REDIS_URI`, matching the existing behavior in `@colyseus/tools`. Single-CPU Cloud instances without `REDIS_URI` keep using Local.
- Guard `Server.gracefullyShutdown()` against `presence` / `driver` being unset during the brief window before `matchMaker.setup()` resolves (relevant when setup is slow, e.g. Redis client connecting).

## 0.17.42

- `defineServer()` / `new Server()`: `express` callback can now return a `Promise<void>`, and is awaited before the transport is marked ready. This lets async setup inside the callback (e.g. `await apolloServer.start()`) complete before any request is served.

## 0.17.41

- Export `registerRoomDefinitions`, `unregisterRoomDefinitions`, `RoomDefinitions`, and `createNodeMatchmakingMiddleware` from `@colyseus/core` (used by `colyseus/vite` plugin).
- Silence expected `ServerError("disconnecting")` in default `onBeforeShutdown`.

### DevMode: 

- fix `gracefullyShutdown` ordering — reject pending `allowReconnection()` deferreds before caching room state, so `onLeave()` cleanup runs first and the cached state doesn't contain stale player data.
- fix reconnection path seat cleanup — delete `_reservedSeats` and `_reconnections` entries after successful reconnection in `_onJoin`, preventing stale seats from blocking room disposal.
- `_reserveSeat` timeout now calls `onLeave()` for clients that fail to reconnect, cleaning up stale player state.
- cache and restore the encoder's `nextRefId` across HMR cycles, ensuring Schema refIds increase monotonically and preventing client-side decoder refId collisions.
- skip restoring reserved seats without a `reconnectionToken` (stale `allowReconnection` from page refresh) to prevent orphaned seats blocking room disposal.
- use `recreatedRoom.seatReservationTimeout` instead of hardcoded 20s in `reloadFromCache`.

## 0.17.40

- Fix endpoints with query params returning 404 when Express app is present. `bindRouterToTransport` was passing `req.url` (including query string) to `router.findRoute()`, causing route mismatches. (thanks @thedomeffm for reporting - https://github.com/colyseus/colyseus/issues/930)
- Internal `onDrop`/`onLeave` errors (e.g. "not joined", "disconnecting", "promise rejected") are no longer logged to stderr. They are now only logged when `DEBUG=colyseus:errors` is enabled.

## 0.17.39

- Introduce `isStandaloneMatchMaker` option for `defineServer()`. When enabled, the current process will not spawn rooms and will only be responsible for matchmaking.

## 0.17.38

- Make `zod` an optional peer dependency

## 0.17.37

- `SchemaSerializer`: fix clearing "full encode" cache when state is mutated while no clients are connected (reported by @krabas https://github.com/colyseus/colyseus/issues/917)

## 0.17.36

- Allow to provide `server` with Express app bound as argument for `WebSocketTransport`, while keeping `better-call` + Express stacks working.
- Fix `Error: 'app.router' is deprecated!` error when not providing `"express"` key to `defineServer()`

## 0.17.35

- Bun: Fix `dynamicImport` utility method to prevent dual-loading of CJS + ESM modules in Bun, causing "seat reservation" errors.

## 0.17.34

- Fix express and auth routes hanging. Use `@colyseus/better-auth` version that exposes `.findRoute()`.

## 0.17.33

- Fix order of route processing. Process custom routes first. This prevents conflict with eager Express routes (e.g. `app.use("/", serveIndex(...), express.static(...))`).

