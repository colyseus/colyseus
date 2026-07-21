# Changelog

## 0.18.1

### Experimental: protocol modifiers + input handshake options

> **Status: experimental.** Wire bytes and section tags may change before 0.18 stable.

- New: `ProtocolModifier` — the leading protocol byte is now split into a base code (bits 0..4, isolated by `PROTOCOL_CODE_MASK`) and composable modifier bits (5..7, `PROTOCOL_MODIFIER_MASK`). First modifier: `ProtocolModifier.TIMED` (`0x80`) — prepends server-time + per-recipient last-input-ack timestamps to `ROOM_STATE` / `ROOM_STATE_PATCH` (emitted whenever the room called `defineInput()`), so the SDK can estimate RTT, server time, and clock offset without application-level cooperation. Also set on `ROOM_INPUT_RELIABLE` when lag-comp attachments require a per-client timeline stamp (delta-coded on the wire).
- New: `HandshakeSection.INPUT_OPTIONS` (`2`) + `InputFlags` — flag bits (some with trailing varints, in bit order) the server hands the SDK at join time: `RENDER_TIME`, `FIXED_TIMESTEP` (tickRate), `PATCH_RATE`, `SUB_STEPS`, `RECKON_TIME`.

### Request/response typing

- New: `MessageContext` — optional 3rd argument to every `messages` handler (`(client, message, ctx)`; existing 2-arg handlers are unaffected). Carries the dispatch `id` (`undefined` for fire-and-forget `room.send`) and the typed reply arms `ctx.resolve(value)` / `ctx.reject(reason)`, producing the branded `Resolution` / `Rejection` types.
- `ExtractResponseType<T>` now subtracts the reply arms from the handler's awaited return type; new `ExtractRejectReason<T>` extracts the typed reject reason (`never` when the handler never rejects).

## 0.18.0

### Experimental: typed binary client→server input

> **Status: experimental.** Wire bytes and section tags may change before 0.18 stable.

- New: `Protocol.ROOM_INPUT_RELIABLE` (`19`) and `Protocol.ROOM_INPUT_UNRELIABLE` (`20`) wire codes for binary input packets sent from the SDK to the server.
- New: `HandshakeSection` enum with `INPUT_REFLECTION = 1` — section tag for trailing tagged blobs in the JOIN_ROOM handshake payload. Unknown tags are skipped via length, so adding new sections is forward-compatible.
- New: `InferInput<T>` type helper — extracts the input schema instance type from a `Room` constructor or instance, used by the SDK to type `conn.input()`.

## 0.17.4

- Initial changelog entry

