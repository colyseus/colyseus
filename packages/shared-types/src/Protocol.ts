/**
 * Colyseus protocol codes occupy bits 0..4 of the leading message byte
 * (values 0..31). Bits 5..7 are reserved for {@link ProtocolModifier}
 * decorations, OR'd onto the base code at send time (composable):
 *
 *     buffer[0] = Protocol.ROOM_INPUT_RELIABLE | ProtocolModifier.TIMED | ProtocolModifier.ACTIONS;
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

  // Input-related (19~20). In-frame rooms ({@link InputFlags.IN_FRAME_ACTIONS})
  // length-prefix the body so a trailing actions section can ride the packet:
  //   reliable:   [byte, stamp?, inputLen varint, input bytes, actions?]
  //   unreliable: [byte, ringLen varint, len|input…, actions?]
  ROOM_INPUT_RELIABLE: 19,   // [byte, ...InputEncoder.encode() bytes]               single input
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
   * Server-time + per-recipient last-input-ack timestamps are prepended to
   * the message body.
   *
   * Layout when set (applied to {@link Protocol.ROOM_STATE} and
   * {@link Protocol.ROOM_STATE_PATCH}):
   *
   *     [code | TIMED][float64 sNow LE][float64 lastTReceived LE][...body]
   *
   * - `sNow` is the server's `performance.now()` at encode time (shared
   *   across all recipients of this tick).
   * - `lastTReceived` is the server's `performance.now()` recorded when the
   *   most recent input from *this specific recipient* arrived. `0` if the
   *   client has never sent an input. Per-recipient — never another client's
   *   ack.
   *
   * The client SDK uses these to estimate RTT, server time, and clock offset
   * without any application-level schema cooperation.
   *
   * Emitted whenever the Room called `defineInput()`. SDK clients that
   * understand the TIMED bit decode the prefix; older clients that don't
   * support it would fail to parse — Colyseus 0.18 introduces the feature
   * alongside the first SDK release that decodes it, so the protocol bump
   * is implicit in the version.
   *
   * Also set on the client→server input opcode
   * ({@link Protocol.ROOM_INPUT_RELIABLE}) when the Room's lag-comp attachments
   * require a per-client stamp. The handshake tells the client which timeline(s)
   * to send via {@link InputFlags.RENDER_TIME} / {@link InputFlags.RECKON_TIME};
   * the prefix shape follows from which flags are set (server reads the length
   * from its own derived mode — the two 4-byte shapes need no wire tag):
   *
   *   - RECKON_TIME only: `[uint32 reckonTime]` (4 B)
   *   - RENDER_TIME only: `[uint32 renderTime]` (4 B)
   *   - BOTH:             `[uint32 reckonTime][uint16 renderDelta]` (6 B)
   *
   * reckonTime (ms since room start) = the client's serverNow estimate at
   * input-sample time — what its forward-RECKONED entities display at, stamped
   * directly so the server's rewind read is immune to the client's
   * RTT-estimation error. renderTime = the snapshot-timeline instant on screen
   * (what a LERPING client shows) = `reckonTime − renderDelta`
   * (≈ `renderDelay + rtt/2`). In the BOTH case the gap is shipped as a u16
   * `renderDelta` (bounded ≪ 65 s) rather than a second u32 and the server
   * derives renderTime; single-timeline rooms ship the one absolute stamp they
   * use. See {@link HandshakeSection.INPUT_OPTIONS} / {@link InputFlags}.
   */
  TIMED: 0x80,

  /**
   * The input packet carries a **trailing actions section** after a
   * length-prefixed body — `predict.action`s riding the input frame (see
   * {@link Protocol.ROOM_INPUT_RELIABLE}). Set per-frame, only when an action
   * rides, and only against a server that advertised
   * {@link InputFlags.IN_FRAME_ACTIONS}; action-less frames stay the legacy
   * body-to-end format (this bit unset). The decoder reads the body length from
   * the prefix, then dispatches the trailing actions tick-aligned.
   */
  ACTIONS: 0x40,

  /**
   * The server→client {@link Protocol.ROOM_STATE_PATCH} carries a **trailing
   * per-recipient frames section** after a length-prefixed patch body — the
   * mirror of {@link ACTIONS} (client→server). Each "frame" is a complete,
   * self-contained message (its own leading opcode, e.g. a
   * {@link Protocol.ROOM_RESPONSE} verdict or a {@link Protocol.ROOM_DATA}),
   * coalesced into the patch so an in-frame `predict.action`'s verdict + its
   * resulting state + the input-ack arrive in ONE frame (brief 21, Design B).
   *
   * Layout when set (after the optional TIMED prefix):
   *
   *     [code | TIMED? | FRAMES][TIMED prefix?]
   *     [varint patchBodyLen][...schema body]
   *     [varint frameCount]([varint frameLen][frame bytes])…
   *
   * The `patchBodyLen` lets the patch decoder stop before the section; the SDK
   * then re-dispatches each frame through the ordinary per-message path. Set
   * per-tick, only when a frame rides — action-less patches leave this bit unset
   * and stay byte-identical (no length prefix), so the hot path pays nothing.
   */
  FRAMES: 0x20,
} as const;
export type ProtocolModifier = typeof ProtocolModifier[keyof typeof ProtocolModifier];

/** Mask isolating the base protocol code (low 5 bits, values 0..31). */
export const PROTOCOL_CODE_MASK = 0x1F;

/** Mask isolating modifier bits (high 3 bits — {@link ProtocolModifier.TIMED} +
 *  {@link ProtocolModifier.ACTIONS} + {@link ProtocolModifier.FRAMES}). */
export const PROTOCOL_MODIFIER_MASK = 0xE0;

/**
 * Status byte of a {@link Protocol.ROOM_RESPONSE} reply, correlating to a
 * pending {@link Protocol.ROOM_REQUEST} on the SDK side. The SDK decodes it into
 * the outcome model `(ok, payload, faulted)`:
 *
 * - `OK` → a `ctx.resolve(value)` (or a plain handler return); payload is the
 *   value, or `{ ref }` when an entity was resolved for a predicted-spawn handoff.
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
   *  lag-compensated hit registration of `mode:"reckon"` rewind targets. When
   *  set together with {@link RENDER_TIME}, the input ships
   *  `[uint32 reckonTime][uint16 renderDelta]`; alone it ships
   *  `[uint32 reckonTime]`. See {@link ProtocolModifier.TIMED}. */
  RECKON_TIME: 1 << 4,
  /** The room reads **in-frame actions**: the input wire format is
   *  length-prefixed (`[inputLen varint][input body]`) so a trailing actions
   *  section can ride the same packet ({@link Protocol.ROOM_INPUT_RELIABLE} /
   *  {@link Protocol.ROOM_INPUT_UNRELIABLE}). Advertised when the server has an
   *  input subsystem that dispatches `predict.action`s tick-aligned. Absent ⇒
   *  the SDK sends the legacy body-to-end format and `predict.action` falls back
   *  to the standalone request/response transport. Carries no trailing varint. */
  IN_FRAME_ACTIONS: 1 << 5,
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
