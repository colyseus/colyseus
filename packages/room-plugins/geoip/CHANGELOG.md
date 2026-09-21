# Changelog

## 0.18.3

- A room now retries loading the GeoIP database after a failed load. The first failure was cached and re-thrown for every room created afterwards, so nothing short of a process restart recovered. Thanks @fatihcvs! [#973](https://github.com/colyseus/colyseus/pull/973)

- A failed auto-refresh now logs a warning. It passed silently, so an expired license key left you serving the database loaded at boot with no sign of it.

- Zero-config `new GeoIPPlugin()` downloads DB-IP's Lite Country database from db-ip.com on first boot and caches it, picking up their monthly snapshot as it lands. It previously read a database meant to be bundled at publish time, which never shipped — so the mode threw `ENOENT` on every room creation.

## 0.18.2

- Internal: the bundled database path resolves through `import.meta.dirname`.
