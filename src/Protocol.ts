// Use codes between 0~127 for lesser throughput (1 byte)

export enum Protocol {
  // User-related (1~10)
  USER_ID = 1,

  // Room-related (10~20)
  JOIN_ROOM = 10,
  JOIN_ERROR = 11,
  LEAVE_ROOM = 12,
  ROOM_DATA = 13,
  ROOM_STATE = 14,
  ROOM_STATE_PATCH = 15,

  // Generic messages (50~60)
  BAD_REQUEST = 50

}
