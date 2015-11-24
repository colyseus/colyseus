// Use some conventions from http status codes
// https://en.wikipedia.org/wiki/List_of_HTTP_status_codes

// 1xx Informational
module.exports.JOIN_ROOM = 100
module.exports.LEAVE_ROOM = 101
module.exports.ROOM_DATA = 102
module.exports.ROOM_STATE = 110
module.exports.ROOM_STATE_PATCH = 111

// 2xx Success

// 3xx Redirection

// 4xx Client Error
module.exports.BAD_REQUEST = 400

// 5xx Server Error
