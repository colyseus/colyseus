# Changelog

## 0.17.41

- Isolate `debug.js` panel inside a Shadow DOM root so page-level CSS (e.g. a global `canvas { width: 100vw }` rule) can no longer stretch or restyle the debug UI.

## 0.17.40

- Fix `client.http.*` type inference wrongly requiring `query` and `params` on endpoints that declared neither (most visible under `strictNullChecks: false`). Closes [#933](https://github.com/colyseus/colyseus/issues/933) - thanks @thedomeffm for reporting!

## 0.17.39

- Allow swapping the `fetch` implementation via `fetchFn` option in `ClientOptions`. Automatically falls back to `XMLHttpRequest` when `fetch` is unavailable (e.g. Cocos Creator Native). Closes [#931](https://github.com/colyseus/colyseus/issues/931) - thanks @liangpei-web for reporting!

## 0.17.38

- Fix HTTP response content-type detection using `indexOf()` instead of `includes()`, which caused non-JSON responses to be incorrectly parsed as JSON

## 0.17.37

- Fix `debug.js` "refId not found" schema decoder errors when connection closes while latency simulation is enabled. The `onclose` handler is now delayed to fire after all pending `onmessage` callbacks.

## 0.17.36

- Fix `debug.js` panel ID collision when the same `sessionId` is reused across rooms (e.g. QueueRoom handoff).

## 0.17.35

- Add `room.reconnection.enabled` flag. Use `sessionStorage` instead of `localStorage` to determine if "debug" panel is hidden.

## 0.17.34

- Bundle `dist/colyseus.js` file with latest `@colyseus/schema` version.

## 0.17.33

- Fix `debug.js` panel to intercept all `consumeSeatReservation()` calls.

## 0.17.32

- Fix `debug.js` panel text color. (#910, thanks @Andrek25)

## 0.17.31

- Fix `debug.js` panel text color. (#909, thanks @Andrek25)

## 0.17.30

- Throw error if requesting to join a room without a room name.
- Fix `e.code` of `client.http.*` errors to always be a number.

## 0.17.29

- Fix `dist/debug.js` build to be embedded via CDN (e.g. `https://unpkg.com/@colyseus/sdk@^0.17.0/dist/debug.js`)

## 0.17.28

- fix displaying correct error message on `ServerError` / `MatchMakeError`

## 0.17.27

- Fix forwarding `?skipHandshake=1` query param if concrete state has been provided.

