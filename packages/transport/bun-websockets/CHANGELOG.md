# Changelog

## 0.17.13

- Use `MAY_TRY_RECONNECT` close code (instead of `FAILED_TO_RECONNECT`) in devMode when a reconnection token is present but the seat hasn't been reserved yet. This allows the SDK to retry during the brief HMR reload window.

## 0.17.12

- Fix `sendBinary requires an ArrayBufferView` error by ensuring `raw()` always passes an `ArrayBufferView` to Bun's `sendBinary()`
- Fix `shutdown()` not fully releasing the port — use `stop(true)` to force-close the listener so a new `Bun.serve()` on the same port gets a fresh handler

## 0.17.11

- Defensive check for enqueuing messages after client has already joined (#927)

## 0.17.10

- Enqueue messages sent during `onReconnect()`, ensuring they arrive after the client completes the reconnection handshake.

## 0.17.9

- Bump `bun-serve-express` version to fix static and Buffer responses.

## 0.17.8

- Fixes retrieving HTTP headers

## 0.17.6

- Initial changelog entry

