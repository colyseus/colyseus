# Changelog

## 0.17.11

- Fix `H3Client` frame reassembly: buffer partial frames across `reader.read()` calls on both the bidirectional stream and datagram reader. A chunk ending mid-payload or inside the varint length prefix no longer causes truncated message dispatch or aborted read loops. Mirrors the SDK-side fix — thanks @anaibol for reporting!

## 0.17.10

- Use `MAY_TRY_RECONNECT` close code (instead of `FAILED_TO_RECONNECT`) in devMode when a reconnection token is present but the seat hasn't been reserved yet. This allows the SDK to retry during the brief HMR reload window.

## 0.17.9

- Defensive check for enqueuing messages after client has already joined (#927)

## 0.17.8

- Enqueue messages sent during `onReconnect()`, ensuring they arrive after the client completes the reconnection handshake.

## 0.17.6

- Initial changelog entry

