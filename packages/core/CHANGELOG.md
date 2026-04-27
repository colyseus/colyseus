# Changelog

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

