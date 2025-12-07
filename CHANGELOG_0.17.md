## Bug fixes / improvemernts to document
[ ] `LobbyRoom` / `enableRealtimeListing()`: fix removing room from lobby listing when room is disposed.
[ ] Room's protected members are now `private` for better DX. If you are using one of the undocumented protected methods, such as `resetAutoDisposeTimeout`, you can call it via `this['resetAutoDisposeTimeout']()`.
[ ] The `.setSeatReservationTime()` method has been moved to `.seatReservationTimeout=` property.
[ ] `Room<State>` is now `Room<Metadata>` (?? - Consider reverting this for fewer breaking changes on 0.17)
[ ] Room's presence pub/sub now can unsubscribe themselves during `onDispose()`
[ ] `.allowReconnection()` breaking changes. (https://github.com/colyseus/colyseus/issues/893)
  [ ] `onLeave(client, code)` - the onLeave now receives close `code` as number instead of `consented` boolean flag.
[ ] `Protocol.WS_*` close codes have been moved to `CloseCode.*`
[ ] Skipping handshake when local state is available (when reconnecting or with concrete state provided)
[ ] Fixed bug where setting `patchRate=0` would stop `clock` intervals and timeouts from working (https://github.com/colyseus/colyseus/issues/869)
[ ] Playground: Automatically-generated postman-like UI

## New features to document

[ ] `@colyseus/tools`: New `routes` and `rooms` options
[ ] `@colyseus/core`: New `defineServer()` option
[ ] Introduced `.setMatchmaking()` for batch modifying the listing entry of the room on the matchmaking driver. Allows to modify `metadata`, `locked`, `maxClients`, etc in a single operation.
[ ] Document `RankedQueueRoom` and its usage example: https://github.com/endel/colyseus-ranked-matchmaking/?tab=readme-ov-file#ranked-queue-with-colyseus
[ ] `@colyseus/sdk/debug` - New embedded realtime debug/inspector for rooms. On Unity available at **Window → Colyseus → Room Inspector**.


## onMessage with raw bytes

We have separate methods now for handling `onMessage()` with raw bytes: `onMessageBytes()`

## HTTP Error Codes on Matchmaking Routes

`MATCHMAKE_NO_HANDLER`: 4210 => 530
`MATCHMAKE_INVALID_CRITERIA`: 4211 => 531
`MATCHMAKE_INVALID_ROOM_ID`: 4212 => 532
`MATCHMAKE_UNHANDLED`: 4213 => 533
`MATCHMAKE_EXPIRED`: 4214 => 534

## TODO:

[x] PostgreSQL match-making driver
[x] debug:* logs should go to STDOUT (not STDERR)
[x] `RoomCache`: remove mongodb-like methods like `.updateOne()`, `save()`, and `remove()`
[x] Check why this test outputs `Error: UNDEFINED_VALUE` for `PostgresDriver`: `npm test -- --grep 'should not exceed maxClients'`
[x] `RoomCache`: improve metadata handling and filters
[ ] Room caching and restoration ("migration") to new server
[ ] `PostgresDriver`: confirm if delay between increment/decrement `clients` is affecting `maxClients` being respected.
[ ] `RedisDriver`: implement `boot()` to create LUA Script for filtering rooms at the server instead of at the Redis client
[ ] Drivers: Allow to filter with OR operation (metaField=X or metaField=Y)
[ ] Support Express v5
[ ] Full-stack type safety
[ ] How to use new `messages = {}` for raw binary data? (`.onMessageBytes()` ??)
[ ] Add Unity-like schema callbacks for TypeScript
[ ] Colyseus Cloud: allow `@colyseus/tools` - `listen()` method to accept a raw `server` instance and make it compatible with Colyseus Cloud infrastructure.
