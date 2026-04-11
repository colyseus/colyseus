# Changelog

## 0.17.10

- Use `MAY_TRY_RECONNECT` close code (instead of `FAILED_TO_RECONNECT`) in devMode when a reconnection token is present but the seat hasn't been reserved yet. This allows the SDK to retry during the brief HMR reload window.

## 0.17.9

- Defensive check for enqueuing messages after client has already joined (#927)

## 0.17.8

- Enqueue messages sent during `onReconnect()`, ensuring they arrive after the client completes the reconnection handshake.

## 0.17.6

- Initial changelog entry

