# Changelog

## 0.18.3

- `require()` of this package now resolves to the same ESM build `import` gets, so a process that uses both no longer loads two copies. [#979](https://github.com/colyseus/colyseus/issues/979)

## 0.18.2

- Requires Node 22.

## 0.17.7

- Add IPv6 support for `internalAddress`. Bracketed (`[::1]:2567`) and bare
  (`fd12::1`) forms are accepted, and registered URLs are properly bracketed.
- `autoDetectInternalIP()` now falls back to the first non-internal,
  non-link-local IPv6 address when no routable IPv4 is available — needed for
  IPv6-only private networks (e.g. Railway).

## 0.17.6

- Initial changelog entry

