/**
 * Colyseus protocol codes occupy bits 0..4 of the leading message byte
 * (values 0..31). Bits 5..7 are reserved for {@link ProtocolModifier}
 * decorations, OR'd onto the base code at send time (composable):
 *
 *     buffer[0] = Protocol.ROOM_INPUT_RELIABLE | ProtocolModifier.TIMED;
 *
 * Decoders strip the modifier bits before dispatching:
 *
 *     const code = buffer[0] & 0x1F;
 *     const modifiers = buffer[0] & 0xE0;
 */
export const Protocol = {
  // Room-related (10~19)
  JOIN_ROOM: 10,
  ERROR: 11,
  LEAVE_ROOM: 12,
  ROOM_DATA: 13,
  ROOM_STATE: 14,
  ROOM_STATE_PATCH: 15,
  ROOM_DATA_SCHEMA: 16, // DEPRECATED: schema instances via room.send()
  ROOM_DATA_BYTES: 17,
  PING: 18,

  // Input-related (19~20).
  ROOM_INPUT_RELIABLE: 19,   // [byte, stamp?, ...InputEncoder.encode() bytes]       single input
  ROOM_INPUT_UNRELIABLE: 20, // [byte, len|input, len|input, ...]                    length-framed ring

  // Request/response (21~22)
  ROOM_REQUEST: 21,  // [byte, requestId varint, type(str|num), msgpack payload]     client→server, expects a reply
  ROOM_RESPONSE: 22, // [byte, requestId varint, status uint8, msgpack payload?]     server→client, reply to a request
} as const;
export type Protocol = typeof Protocol[keyof typeof Protocol];

/**
 * Modifier bits OR'd into the leading protocol byte. Composable — multiple
 * modifiers can be combined on a single message; the decoder strips them in
 * a preamble step that precedes the existing protocol-code dispatch.
 *
 * Add a new modifier here when a feature wants to decorate the envelope of
 * an existing message kind rather than mint a new code.
 */
export const ProtocolModifier = {
  /**
   * Server-time + per-recipient last-input-ack are prepended to the message
   * body.
   *
   * Layout when set (applied to {@link Protocol.ROOM_STATE} and
   * {@link Protocol.ROOM_STATE_PATCH}):
   *
   *     [code | TIMED][uint32 sNow LE][uint32 inputSeq LE][...body]
   *
   * - `sNow` is the server clock as ms since room start
   *   (`room.clock.elapsedTime` — NOT raw `performance.now()`; portable
   *   integer, wraps at u32 ≈ 49.7 days). Shared across all recipients of
   *   this tick.
   * - `inputSeq` is the seq value of the last input CONSUMED into the
   *   authoritative state from *this specific recipient* (`0` if the client
   *   never sent an input). Per-recipient — never another client's ack.
   *
   * Authoritative field semantics: the `TIMED_PREFIX_SIZE` doc in
   * `@colyseus/core` `serializer/SchemaSerializer.ts`.
   *
   * The client SDK uses these to estimate RTT, server time, and clock offset
   * (and to prune its reconciliation replay buffer) without any
   * application-level schema cooperation.
   *
   * Emitted whenever the Room called `defineInput()`. SDK clients that
   * understand the TIMED bit decode the prefix; older clients that don't
   * support it would fail to parse — Colyseus 0.18 introduces the feature
   * alongside the first SDK release that decodes it, so the protocol bump
   * is implicit in the version.
   *
   * Also set on either client→server input opcode
   * ({@link Protocol.ROOM_INPUT_RELIABLE} / {@link Protocol.ROOM_INPUT_UNRELIABLE})
   * when the Room's lag-comp attachments require a per-client stamp. The
   * handshake tells the client which timeline(s) to send via
   * {@link InputFlags.RENDER_TIME} / {@link InputFlags.RECKON_TIME}; the prefix
   * shape follows from which flags are set — and from the channel, because the
   * two have different delivery guarantees.
   *
   * RELIABLE carries ONE stamp for its single input, DELTA-CODED: each frame
   * ships the signed change from the previous stamp via the self-describing
   * number codec (≈ one fixed step per tick → ~1 byte vs a raw 4-byte u32; the
   * first frame / post-reset ships the absolute as a one-off larger delta). The
   * server reconstructs it against a per-client baseline both sides re-zero
   * together on (re)connect:
   *
   *   - RECKON_TIME only: `[varint Δreckon]`
   *   - RENDER_TIME only: `[varint Δrender]`
   *   - BOTH:             `[varint Δreckon][uint16 renderDelta]`
   *
   * UNRELIABLE carries a SELF-CONTAINED block, one stamp per ring slot, because
   * the packet holds `k` inputs sampled at `k` different instants and a running
   * baseline cannot survive loss or reordering:
   *
   *       [varint k][uint32 newest][varint Δ]×(k−1)
   *       [uint16 rdNewest][varint Δrd]×(k−1)        ← BOTH mode only
   *
   * `newest` is absolute, and each Δ walks one slot older
   * (`stamp[i] = stamp[i+1] − Δ`) — so a packet is readable on its own and an
   * input recovered redundantly from a later packet still arrives with its own
   * instant. Stamps pair positionally with the ring's oldest→newest slots.
   *
   * BOTH mode trails the `renderDelta` series in the same shape — one value per
   * slot, not one per packet — so each input keeps the interp buffer plus
   * one-way latency it was actually sampled with. Consecutive values differ by
   * ~0–1 ms, which the number codec encodes in one byte, so per-slot exactness
   * costs `k−1` bytes over a single shared value.
   *
   * The block is all-or-nothing: every slot is stamped, or the bit is not set.
   * A client's `allowRewind` gates the RELIABLE opcode only — here the block
   * ships whole, so excluding a slot would save nothing and would make its
   * neighbour's delta swing the full absolute value. Slots sampled before the
   * client's clock synced ship as `0`, the standard "unstamped, read live"
   * sentinel.
   *
   * reckonTime (ms since room start) = the client's serverNow estimate at
   * input-sample time — what its forward-RECKONED entities display at, stamped
   * directly so the server's rewind read is immune to the client's
   * RTT-estimation error. renderTime = the snapshot-timeline instant on screen
   * (what a LERPING client shows) = `reckonTime − renderDelta`
   * (≈ `renderDelay + rtt/2`). In the BOTH case the gap is shipped as a u16
   * `renderDelta` (bounded ≪ 65 s) rather than a second delta and the server
   * derives renderTime; single-timeline rooms ship the one timeline they use.
   * See {@link HandshakeSection.INPUT_OPTIONS} / {@link InputFlags}.
   */
  TIMED: 0x80,

  /**
   * The frame rode the transport's UNRELIABLE channel (a WebTransport datagram)
   * and may therefore be lost, duplicated, or reordered.
   *
   * Layout when set (applied to {@link Protocol.ROOM_STATE_PATCH}):
   *
   *     [code | UNRELIABLE][uint16 seq LE][...body]
   *
   * - `seq` is a room-wide counter incremented once per unreliable flush and
   *   shared by every recipient of that flush. It wraps at 65536, so freshness
   *   is a wrap-safe comparison — `(int16)(seq - lastApplied) > 0` — not `>`.
   *   The client drops any frame that isn't newer than the last one it applied;
   *   a reordered datagram would otherwise write a stale value that survives
   *   until the field changes again.
   *
   * Carries only fields marked `@unreliable` in the state schema. Those are
   * restricted to primitives, so every ADD/DELETE of a ref still travels the
   * reliable channel: a dropped frame costs a stale field value and can never
   * desync the ref graph.
   *
   * Never combined with {@link ProtocolModifier.TIMED}. The clock sample and the
   * input ack must arrive in order to be meaningful, so they stay exclusive to
   * the reliable patch — which already emits a per-tick heartbeat in rooms that
   * called `defineInput()`.
   */
  UNRELIABLE: 0x40,
} as const;
export type ProtocolModifier = typeof ProtocolModifier[keyof typeof ProtocolModifier];

/** Mask isolating the base protocol code (low 5 bits, values 0..31). */
export const PROTOCOL_CODE_MASK = 0x1F;

/** Mask isolating modifier bits (high 3 bits; {@link ProtocolModifier.TIMED} and
 *  {@link ProtocolModifier.UNRELIABLE} are assigned, the third is reserved). */
export const PROTOCOL_MODIFIER_MASK = 0xE0;

/**
 * Status byte of a {@link Protocol.ROOM_RESPONSE} reply, correlating to a
 * pending {@link Protocol.ROOM_REQUEST} on the SDK side. The SDK decodes it into
 * the outcome model `(ok, payload, faulted)`:
 *
 * - `OK` → a `ctx.resolve(value)` (or a plain handler return); payload is the value.
 * - `REJECTED` → a deliberate, typed `ctx.reject(reason)`; the authored reason
 *   rides as the payload, surfaced verbatim and typed.
 * - `ERROR` → a *fault* (handler threw, or no handler registered): `faulted` on
 *   the client. Payload is a sanitized `{ name, message, code? }`, never a raw
 *   reason — so a crash can't masquerade as a typed reject.
 *
 * Byte values freeze at the first 0.18 release; add statuses by appending, never
 * by renumbering.
 */
export const ResponseStatus = {
  OK: 0,
  REJECTED: 1,
  ERROR: 2,
} as const;
export type ResponseStatus = typeof ResponseStatus[keyof typeof ResponseStatus];

/**
 * Section tags for trailing tagged blobs in the JOIN_ROOM handshake payload.
 *
 * Layout after the existing `[rt][sid][stateReflection]` fields:
 *   while (more bytes):
 *     section tag (uint8)
 *     section length (varint)
 *     section payload (length bytes)
 *
 * Unknown tags are skipped via `length`, so adding new sections is
 * forward-compatible with older clients.
 */
export const HandshakeSection = {
  /**
   * Reflection bytes (`Reflection.encode`) for the Room's input schema —
   * present when the server called `defineInput()`. The SDK reconstructs a
   * constructor and uses it as the default for `conn.input()` calls that
   * don't pass an explicit `type`.
   */
  INPUT_REFLECTION: 1,

  /**
   * Input feature flags + optional values the client mirrors — present when the
   * Room called `defineInput()`. Layout:
   * `[flags uint8][tickRate varint?][patchRate varint?][subSteps varint?]`,
   * bits per {@link InputFlags}; trailing varints appear in flag-bit order
   * when set.
   */
  INPUT_OPTIONS: 2,
} as const;
export type HandshakeSection = typeof HandshakeSection[keyof typeof HandshakeSection];

/**
 * Bit flags packed into the leading byte of the
 * {@link HandshakeSection.INPUT_OPTIONS} section. Some flags imply a trailing
 * varint in the section payload (see each flag), appended in bit order.
 */
export const InputFlags = {
  /** Client auto-stamps reliable inputs with the SNAPSHOT-timeline instant it
   *  was rendering (`renderTime`, ms since room start) for lag-compensated hit
   *  registration of `mode:"snapshot"` rewind targets. Prefix shape depends on
   *  whether {@link RECKON_TIME} is also set — see {@link ProtocolModifier.TIMED}. */
  RENDER_TIME: 1 << 0,
  /** A `[tickRate varint]` (Hz) follows — the server's fixed sim/input step
   *  rate. The client predicts at dt = 1/tickRate. */
  FIXED_TIMESTEP: 1 << 1,
  /** A `[patchRate varint]` (ms) follows — the server's state-patch interval =
   *  the reconcile/correction cadence. The client tunes smoothing to it. */
  PATCH_RATE: 1 << 2,
  /** A `[subSteps varint]` (count ≥ 2) follows — physics sub-steps per input
   *  tick. The simulation integrates `subSteps` engine steps of
   *  `(1/tickRate)/subSteps` per input, identically on both sides, so the
   *  physics rate is `tickRate * subSteps` while the input/network rate stays
   *  `tickRate`. Absent ⇒ 1 (input rate == physics rate). */
  SUB_STEPS: 1 << 3,
  /** Client auto-stamps reliable inputs with the RECKON-timeline instant
   *  (`reckonTime` = its serverNow estimate, ms since room start) for
   *  lag-compensated hit registration of `mode:"reckon"` rewind targets. The
   *  stamp is DELTA-CODED (signed varint vs the previous stamp): together with
   *  {@link RENDER_TIME} the input ships `[varint Δreckon][uint16 renderDelta]`;
   *  alone it ships `[varint Δreckon]`. See {@link ProtocolModifier.TIMED}. */
  RECKON_TIME: 1 << 4,
} as const;
export type InputFlags = typeof InputFlags[keyof typeof InputFlags];

/**
 * HTTP MatchMaking Error Codes
 */
export const ErrorCode = {
  MATCHMAKE_NO_HANDLER: 520,
  MATCHMAKE_INVALID_CRITERIA: 521,
  MATCHMAKE_INVALID_ROOM_ID: 522,
  MATCHMAKE_UNHANDLED: 523, // generic exception during onCreate/onJoin
  MATCHMAKE_EXPIRED: 524, // generic exception during onCreate/onJoin
  AUTH_FAILED: 525,
  APPLICATION_ERROR: 526,

  INVALID_PAYLOAD: 4217,
} as const;
export type ErrorCode = typeof ErrorCode[keyof typeof ErrorCode];

/**
 * WebSocket close codes
 * (See https://github.com/Luka967/websocket-close-codes)
 */
export const CloseCode = {
  NORMAL_CLOSURE: 1000,
  GOING_AWAY: 1001,
  NO_STATUS_RECEIVED: 1005,
  ABNORMAL_CLOSURE: 1006,

  CONSENTED: 4000,
  SERVER_SHUTDOWN: 4001,
  WITH_ERROR: 4002,
  FAILED_TO_RECONNECT: 4003,

  MAY_TRY_RECONNECT: 4010,
} as const;
export type CloseCode = typeof CloseCode[keyof typeof CloseCode];
