# Changelog

## 0.18.0

### Experimental: typed binary client→server input

> **Status: experimental.** Wire bytes and section tags may change before 0.18 stable.

- New: `Protocol.ROOM_INPUT_RELIABLE` (`19`) and `Protocol.ROOM_INPUT_UNRELIABLE` (`20`) wire codes for binary input packets sent from the SDK to the server.
- New: `HandshakeSection` enum with `INPUT_REFLECTION = 1` — section tag for trailing tagged blobs in the JOIN_ROOM handshake payload. Unknown tags are skipped via length, so adding new sections is forward-compatible.
- New: `InferInput<T>` type helper — extracts the input schema instance type from a `Room` constructor or instance, used by the SDK to type `conn.input()`.

## 0.17.4

- Initial changelog entry

