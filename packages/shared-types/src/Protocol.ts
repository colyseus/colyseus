/**
 * Colyseus protocol codes occupy bits 0..6 of the leading message byte
 * (values 0..127). Bit 7 onward is reserved for {@link ProtocolModifier}
 * decorations, OR'd onto the base code at send time:
 *
 *     buffer[0] = Protocol.ROOM_STATE_PATCH | ProtocolModifier.TIMED;
 *
 * Decoders strip the modifier bits before dispatching:
 *
 *     const code = buffer[0] & 0x7F;
 *     const modifiers = buffer[0] & 0x80;
 */
export const Protocol = {
  // Room-related (10~19)
  JOIN_ROOM: 10,
  ERROR: 11,
  LEAVE_ROOM: 12,
  ROOM_DATA: 13,
  ROOM_STATE: 14,
  ROOM_STATE_PATCH: 15,
  ROOM_DATA_SCHEMA: 16, // DEPRECATED: used to send schema instances via room.send()
  ROOM_DATA_BYTES: 17,
  PING: 18,

  // Input-related (19~20)
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
   */
  TIMED: 0x80,
} as const;
export type ProtocolModifier = typeof ProtocolModifier[keyof typeof ProtocolModifier];

/** Mask isolating the base protocol code (low 7 bits). */
export const PROTOCOL_CODE_MASK = 0x7F;

/** Mask isolating modifier bits (high bit, room for 7 future flags). */
export const PROTOCOL_MODIFIER_MASK = 0x80;

/**
 * Status byte of a {@link Protocol.ROOM_RESPONSE} reply, correlating to a
 * pending {@link Protocol.ROOM_REQUEST} on the SDK side.
 */
export const ResponseStatus = {
  OK: 0,
  ERROR: 1,
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
} as const;
export type HandshakeSection = typeof HandshakeSection[keyof typeof HandshakeSection];

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
