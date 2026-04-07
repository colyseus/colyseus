# Changelog

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

