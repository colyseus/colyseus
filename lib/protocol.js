"use strict";

// Use codes between 0~127 for lesser throughput (1 byte)

// User-related (0~10)
module.exports.USER_ID = 1

// Room-related (10~20)
module.exports.JOIN_ROOM = 10
module.exports.JOIN_ERROR = 12
module.exports.LEAVE_ROOM = 12
module.exports.ROOM_DATA = 13
module.exports.ROOM_STATE = 14
module.exports.ROOM_STATE_PATCH = 15

// Generic messages (50~60)
module.exports.BAD_REQUEST = 50
