# Changelog

## 0.17.33

- Fix order of route processing. Process custom routes first. This prevents conflict with eager Express routes (e.g. `app.use("/", serveIndex(...), express.static(...))`).

