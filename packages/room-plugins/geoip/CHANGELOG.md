# Changelog

## 0.18.3

- A room now retries loading the GeoIP database after a failed load. The first failure was cached and re-thrown for every room created afterwards, so nothing short of a process restart recovered. Thanks @fatihcvs! [#973](https://github.com/colyseus/colyseus/pull/973)

- A failed auto-refresh now logs a warning. It passed silently, so an expired license key left you serving the database loaded at boot with no sign of it.

## 0.18.2

- Internal: the bundled database path resolves through `import.meta.dirname`.
