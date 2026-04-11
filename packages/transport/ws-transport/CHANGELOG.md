# Changelog

## 0.17.13

- Use `MAY_TRY_RECONNECT` close code (instead of `FAILED_TO_RECONNECT`) in devMode when a reconnection token is present but the seat hasn't been reserved yet. This allows the SDK to retry during the brief HMR reload window.

## 0.17.12

- Add `attachToServer()` method and `AttachToServerOptions` for sharing an external HTTP server (e.g. Vite's dev server) instead of creating a dedicated one.
- Add `noServer` support in constructor to allow deferred attachment via `attachToServer()`.
- Add `shouldShutdownServer` flag to prevent closing shared HTTP servers on `shutdown()`.
- Start heartbeat ping immediately when attaching to an already-listening server.

## 0.17.11

- Defensive check for enqueuing messages after client has already joined (#927)

## 0.17.10

- Enqueue messages sent during `onReconnect()`, ensuring they arrive after the client completes the reconnection handshake.

## 0.17.8

- Initial changelog entry

