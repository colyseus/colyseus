# Changelog

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

