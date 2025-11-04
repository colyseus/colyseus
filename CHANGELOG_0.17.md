## Bug fixes to document
[ ] `LobbyRoom` / `enableRealtimeListing()`: fix removing room from lobby listing when room is disposed.
[ ] Room's protected members are now `private` for better DX. If you are using one of the undocumented protected methods, such as `resetAutoDisposeTimeout`, you can call it via `this['resetAutoDisposeTimeout']()`.

## New features to document

[ ] `@colyseus/tools`: New `routes` and `rooms` options
[ ] `@colyseus/core`: New `defineServer()` option

## onMessage with raw bytes

We have separate methods now for handling `onMessage()` with raw bytes: `onMessageBytes()`

## HTTP Error Codes on Matchmaking Routes

`MATCHMAKE_NO_HANDLER`: 4210 => 530
`MATCHMAKE_INVALID_CRITERIA`: 4211 => 531
`MATCHMAKE_INVALID_ROOM_ID`: 4212 => 532
`MATCHMAKE_UNHANDLED`: 4213 => 533
`MATCHMAKE_EXPIRED`: 4214 => 534

## TODO:

[ ] `RedisDriver`: implement `boot()` to create LUA Script for filtering rooms at the server instead of at the Redis client
[x] debug:* logs should go to STDOUT (not STDERR)
[x] `RoomCache`: remove mongodb-like methods like `.updateOne()`, `save()`, and `remove()`
[x] Check why this test outputs `Error: UNDEFINED_VALUE` for `PostgresDriver`: `npm test -- --grep 'should not exceed maxClients'`
[ ] `RoomCache`: improve metadata handling and filters
[ ] Support Express v5
[ ] Full-stack type safety
[ ] PostgreSQL match-making driver
[ ] How to use new `messages = {}` for raw binary data? (`.onMessageBytes()` ??)
[ ] Add Unity-like schema callbacks for TypeScript
[ ] Colyseus Cloud: allow `@colyseus/tools` - `listen()` method to accept a raw `server` instance and make it compatible with Colyseus Cloud infrastructure.