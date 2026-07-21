# Changelog

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

