# Changelog

## 0.17.34

- Fix express and auth routes hanging. Use `@colyseus/better-auth` version that exposes `.findRoute()`.

## 0.17.33

- Fix order of route processing. Process custom routes first. This prevents conflict with eager Express routes (e.g. `app.use("/", serveIndex(...), express.static(...))`).

