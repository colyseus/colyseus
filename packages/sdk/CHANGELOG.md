# Changelog

## 0.18.0

### Experimental: typed binary client→server input

> **Status: experimental.** API surface and wire format may change before 0.18 stable. Feedback welcome.

- New: `conn.input(options?)` returns a cached per-room `ClientInputHandle<I>`:
  - `.data` — mutable schema instance; mutate, then call `.send()`
  - `.send()` — encodes via `InputEncoder` and routes to reliable or unreliable channel based on `mode`
  - `.reset()` — drops the unreliable ring buffer; re-marks every populated field as dirty in delta mode
  - `.mode` — read-only wire mode

  Schema discovery, in order:
  1. `options.type` — explicit constructor (always works).
  2. Server-sent reflection from the JOIN handshake — the SDK reconstructs the input class via `Reflection.decode` and `Reflection.makeEncodable` (requires `@colyseus/schema@^5.0.3`). The synthesized class has the same fields as the server's input schema; `instanceof YourInput` won't pass on it.
- Recommended for rollback netcode: `{ mode: "unreliable", delta: true, historySize: 4 }` — small redundant deltas, idempotent across drops via absolute-value wire ops.
- Generics intentionally unconstrained (`<I = any>`) so user input classes coming from a different copy of `@colyseus/schema` (multi-version installs) still type-check. Runtime is duck-typed via the encoder.
- Handshake: SDK now parses tagged sections trailing the existing JOIN_ROOM payload (`[tag (uint8)][length (varint)][payload]`); unknown tags are skipped via length, so future sections are forward-compatible.
- **Breaking:** the previously unreleased `room.setInput(instance, options?)` / `room.flushInput()` / `get input()` API is gone. Migrate to `conn.input(...)`.

### Other

- Bump `@colyseus/schema` to `^5.0.3` (required for `Reflection.makeEncodable`).

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

