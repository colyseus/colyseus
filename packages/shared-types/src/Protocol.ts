/**
 * Colyseus protocol codes range between 0~100
 * Use codes between 0~127 for lesser throughput (1 byte)
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
} as const;
export type Protocol = typeof Protocol[keyof typeof Protocol];

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
