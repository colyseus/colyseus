# Changelog

## 0.17.16

- Fix `HPE_UNEXPECTED_CONTENT_LENGTH` error (#908), thanks to @lkinasiewicz

## 0.17.15

- Fix express and auth routes hanging. Use `@colyseus/better-auth` version that exposes `.findRoute()`.

## 0.17.14

- Fix order of header write order on HTTP requests, which was conflicting with `serve-index` Express module.

