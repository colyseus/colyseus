# Changelog

## 0.18.4

- Message and endpoint schemas from any Standard Schema library are now rendered as forms — zod, Effect, arktype, valibot, sury. Non-zod validators used to throw `Cannot read properties of undefined (reading 'def')` and block the room join. [#955](https://github.com/colyseus/colyseus/issues/955)

## 0.18.3

- Opening the playground without the trailing slash (`/playground`) now redirects to `/playground/` instead of rendering a blank page.

- The panel now works at any express mount path — `app.use("/anything", playground())` — with no `prefix` option needed.

## 0.18.2

- Fix the CommonJS build crashing on import, which also took down `require("colyseus")`.

- `/playground/profiling` now finds `cpupro` under CommonJS. It reported the package as missing even when installed.

- Node.js 22 is now the declared minimum (`engines`).

## 0.18.1

- Security: data endpoints (room listing/inspection, API docs listing, CPU profiles) are now gated. They stay open during local development (devMode, or `NODE_ENV !== "production"`); on production mounts they return 404 unless a `use:` middleware guard is configured — the guard is the opt-in, and a one-time warning reminds you to make it enforce authentication.
- API docs listing no longer includes `SERVER_ONLY` endpoints (they aren't routable).
- Connection inspector: send **requests** (`room.request()`) in addition to fire-and-forget messages — the response row pairs with its request and shows an `ok` / `rejected` / `error` status badge plus the round-trip time.

## 0.17.12

- Make `zod` an optional peer dependency

## 0.17.11

- Fix memory leaks inspecting rooms

## 0.17.10

- Initial changelog entry

