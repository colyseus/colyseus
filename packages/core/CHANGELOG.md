# Changelog

## 0.17.50

- Fix message types and room names that collide with `Object.prototype` keys (`__proto__`, `constructor`, `toString`, `valueOf`, `hasOwnProperty`, …) resolving to inherited members on the plain objects used as dispatch registries. Three symptoms: `onMessage("constructor", cb)` threw at registration (`this.events[event].push is not a function`), so the room failed to be created at all; an incoming message with such a type false-positived the per-type validator lookup, threw inside `standardValidate()` and disconnected the sender with `WITH_ERROR` instead of reaching the registered handler or the `'*'` catch-all; and matchmaking against such a room name surfaced `handler.getFilterOptions is not a function` instead of `MATCHMAKE_NO_HANDLER`. The handler, validator and room-handler registries are now null-prototype objects, so these types behave like any other. Regression tests under "message types colliding with Object.prototype keys" (`Integration.test.ts`) and "room names colliding with Object.prototype keys" (`MatchMaker.test.ts`). Note that the process-killing variant reported against 0.16 does not apply to 0.17: 0.16 indexed `onMessageHandlers` directly and called `.callback` on the inherited value, throwing an uncaught exception outside dispatch; 0.17 restructured this and only ever dropped the client. (thanks @BestOlumese for the report and repro - https://github.com/colyseus/colyseus/issues/951)
- Fix `matchMaker.remoteRoomCall()` return type resolving to a union of every room member instead of the selected method's return type. The method name is now captured as a literal type parameter, so `remoteRoomCall(roomId, 'myMethod')` (types inferred) and `remoteRoomCall<MyRoom, 'myMethod'>(roomId, 'myMethod')` (both type arguments given) resolve to the method's awaited return type — or the property's type when accessing an attribute. Note that `remoteRoomCall<MyRoom>(roomId, 'myMethod')` with *only* the room type given cannot be made precise: TypeScript applies the method parameter's default instead of inferring the literal once an explicit type argument list is present (microsoft/TypeScript#26242) — that call style now resolves to `any` rather than the previous member-union noise; pass both type arguments for a precise result. A fallback overload keeps dynamic method names (not present on the room type — e.g. rooms defined via `defineRoomType()`, or private methods) compiling as before, typed `any`. (thanks @ColaFanta for reporting - https://github.com/colyseus/colyseus/issues/952)
- Fix JSDoc `@param` names that did not match the actual arguments, which reach users through editor tooltips and the generated docs: `Room.allowReconnection()` documented `client` (the parameter is `previousClient`), and `matchMaker.findOneRoomAvailable()` documented `sortOptions` — the parameter is `additionalSortOptions`, and `sortOptions` is a different value inside the function (the room handler's defaults, with the argument merged over them). (thanks @darkdi for the fix - https://github.com/colyseus/colyseus/pull/953)
- Typing tests are now normalized on vitest typecheck mode (`test/*.test-d.ts` with `expectTypeOf`): the compile-only strict-declarations suite in `@colyseus/core` was converted from an ad-hoc `tsc -p` script, and `@colyseus/shared-types` now actually enforces its existing type assertions (`expectTypeOf` is a runtime no-op unless typecheck mode is enabled). Internal only — no published API change.

## 0.17.49

- Fix `matchMaker.stats.local.ccu` drifting negative when `onDrop()` `await`s `allowReconnection()`. After a successful reconnection followed by another disconnect, a single client emitted `'leave'` twice for one `'join'`, and the room's `onLeave()` was called twice.

## 0.17.48

- Fix reconnection being killed right after succeeding when `onDrop` `await`s `allowReconnection()` and the server never saw the old connection close. As reported: a page refresh behind a proxy that discards in-flight data on disconnect (swallowing the client's WS close frame — observed on Render.com) leaves the server believing the old connection is still alive; a page refresh on localhost doesn't trigger it because the close frame reaches the server. When the reconnect request arrived in that state, `checkReconnectionToken()` force-closed the stale client and deferred `client.leave(4002)` until `_onLeave` resolved — but with an awaited `allowReconnection()`, `_onLeave` resolves only *after* the successful reconnection has transplanted the new socket into `client.ref`, so the deferred `leave()` closed the freshly reconnected socket (`onDrop 4002 → onReconnect → onDrop 4002 → onLeave 4002`, with the client burning its retry budget against a dead session). The deferred `leave()` is now skipped when the client's `ref` has been transplanted by a successful reconnection. Regression test under "Auto-reconnection" in `bundles/colyseus/test/RoomReconnection.test.ts` — no proxy needed: calling `reconnect()` while the old connection is still open creates the same server-side state. (thanks @ehart004 for the detailed diagnosis - https://github.com/colyseus/colyseus/issues/950)

## 0.17.47

- Fix `TS2883` / `TS2742` ("The inferred type of ... cannot be named without a reference to `StandardSchemaV1` ... This is likely not portable") when emitting declarations for code that calls `createEndpoint()`. The inferred return type expands to a structure naming `StandardSchemaV1`, which is declared inside `@colyseus/better-call` — a package consumers do not depend on directly, and which under pnpm's isolated `node_modules` is only reachable through `.pnpm/…`. TypeScript therefore refuses to emit the reference. `@colyseus/core` now re-exports every `@colyseus/better-call` type reachable from an inferred type: `StandardSchemaV1`, `MiddlewareOptions`, `MiddlewareInputContext`, `CookieOptions`, `CookiePrefixOptions` and `Status`. (thanks @ColaFanta for reporting - https://github.com/colyseus/colyseus/issues/949)
- The same error also affected `createMiddleware()`, `createRouter()` and endpoints using `ctx.setCookie()`. Only isolated `node_modules` layouts (pnpm) were affected — npm/yarn hoisting makes `@colyseus/better-call` reachable from the project root, which is why this went unnoticed. No runtime or public API change: the added exports are type-only, and they live on `@colyseus/core/router/index` rather than the package root so the top-level API surface is unchanged.

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

