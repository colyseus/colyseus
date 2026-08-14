# Changelog

> **Status: experimental.** WebTransport is the only Colyseus transport with a
> real unreliable channel, and it is what `room.input({ mode: "unreliable" })`
> and `@unreliable` state fields need to actually ride datagrams — on any
> WebSocket transport that traffic is correct but travels the reliable channel.
> The API surface and wire format may change before 0.18 stable. Browser support
> is not universal (absent in Safari at time of writing). Feedback welcome.

## Unreleased

- Server→client unreliable delivery: `H3Client.rawUnreliable()` sends over datagrams, and `@colyseus/core` uses it for `@unreliable` state fields. Replaces `sendDatagram()`, which nothing called. A frame over the QUIC datagram limit is dropped with a warning rather than split — a frame spread across two datagrams would corrupt the receiver's framing the first time one is lost. `H3_DATAGRAM_LOSS_OUT=<0..1>` injects outgoing loss (the existing `H3_DATAGRAM_LOSS` stays incoming-only). Requires `@colyseus/core` with the unreliable state channel.

## 0.18.1

WebTransport delivery works again end-to-end (browser and Node clients) — the transport had drifted and needed several fixes:

- Frame reassembly on **both** readers: the new `FrameReassembler` (exported) buffers partial data across `reader.read()` calls on the bidirectional stream *and* the datagram reader, dispatching only complete length-prefixed frames. Extends the 0.17.11 stream-side fix to datagrams.
- Compatibility with `@fails-components/webtransport` 1.6: prefer `datagrams.createWritable()` over the deprecated `datagrams.writable` getter. Dependency bumped to `^1.6.2`.
- Dev certificates: new `resolveDevCertificate(hostname)` (+ `DevCertificate` type) prefers a browser-**trusted** certificate via the `mkcert` tool — no `--ignore-certificate-errors` flag, no `serverCertificateHashes` pinning, and the HTTPS matchmake endpoint is trusted too. Falls back to the bundled self-signed generator with fingerprint pinning when `mkcert` isn't available. Set `H3_SELF_SIGNED=1` to force the self-signed path (required for Node WebTransport clients, which validate via fingerprint pinning only).
- Unreliable client→server input (`mode: "unreliable"`) rides WebTransport datagrams. `H3_DATAGRAM_LOSS=<0..1>` injects incoming datagram loss to exercise the input redundancy ring.
- Internal: raw send queueing delegates to `enqueueClientRaw()` from core. Requires `@colyseus/core` 0.18.1.

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

