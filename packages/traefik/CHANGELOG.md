# Changelog

## 0.17.8

- No longer requires the latest `@colyseus/core` and `@colyseus/redis-presence`: any 0.17 version works.

## 0.17.7

- Add IPv6 support for `internalAddress`. Bracketed (`[::1]:2567`) and bare
  (`fd12::1`) forms are accepted, and registered URLs are properly bracketed.
- `autoDetectInternalIP()` now falls back to the first non-internal,
  non-link-local IPv6 address when no routable IPv4 is available — needed for
  IPv6-only private networks (e.g. Railway).

## 0.17.6

- Initial changelog entry

