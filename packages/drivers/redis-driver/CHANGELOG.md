# Changelog

## 0.18.4

- Lets `@colyseus/core` 0.18.17 prevent a duplicate room when another process answers a create request after it timed out. [#978](https://github.com/colyseus/colyseus/issues/978)
- `query()` now filters by room name before parsing, as `findOne()` already did — it was parsing every room cache in the cluster on each call.

## 0.18.3

- `require()` of this package now resolves to the same ESM build `import` gets, so a process that uses both no longer loads two copies. [#979](https://github.com/colyseus/colyseus/issues/979)

## 0.18.2

- `clear()` (test-suite helper) no longer fires the Redis deletion without awaiting it.

## 0.17.7

- Accept a `Redis` or `Cluster` client instance in the constructor (#928)

## 0.17.6

- Initial changelog entry

