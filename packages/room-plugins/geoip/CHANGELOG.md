# Changelog

## 0.18.3

- A room now retries loading the GeoIP database after a failed load. The first failure was cached and re-thrown for every room created afterwards, so nothing short of a process restart recovered. Thanks @fatihcvs! [#973](https://github.com/colyseus/colyseus/pull/973)

## 0.18.2

- Internal: the bundled database path resolves through `import.meta.dirname`.
