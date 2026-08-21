# Changelog

## 0.18.5

- Fix admin URLs two or more levels deep (`/admin/rooms/<id>`, `/admin/users/show/<id>`) rendering a blank page on direct load, refresh or bookmark.

## 0.18.4

- `admin()` now works under any express path mount: `app.use("/x", admin())` serves the UI at `/x/` with the API at `/x/admin-api`. Previously only a root mount (or `createRouter`) worked — sub-mounting rendered the UI but every API call 404'd. Reverse-proxy sub-paths are also supported via `X-Forwarded-Prefix`, and customizing `uiPath`/`apiPath` no longer breaks the prebuilt UI.

## 0.18.3

- The bare-path redirect (`/admin` → `/admin/`) is now a 302, so browsers no longer cache it permanently.

## 0.18.2

- Fix the published package shipping without its `build/` directory, so nothing it exported could be resolved. 0.18.0 and 0.18.1 are unusable.

- Node.js 22 is now the declared minimum (`engines`).
