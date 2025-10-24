## New features to document

[ ] `@colyseus/tools`: New `routes` and `rooms` options
[ ] `@colyseus/core`: New `defineServer()` option

## onMessage with raw bytes

onMessage() -> onMessageBytes()

## HTTP Error Codes on Matchmaking Routes

`MATCHMAKE_NO_HANDLER`: 4210 => 510
`MATCHMAKE_INVALID_CRITERIA`: 4211 => 511
`MATCHMAKE_INVALID_ROOM_ID`: 4212 => 512
`MATCHMAKE_UNHANDLED`: 4213 => 513
`MATCHMAKE_EXPIRED`: 4214 => 514

## TODO:

[ ] Full-stack type safety
[ ] PostgreSQL match-making driver
[ ] debug:* logs should go to STDOUT (not STDERR)
[ ] How to use new `messages = {}` for raw binary data? (`.onMessageBytes()` ??)
[ ] `RoomCache`: remove mongodb-like methods like `.updateOne()`, `save()`, and `remove()`
[ ] `RoomCache`: improve metadata handling and filters