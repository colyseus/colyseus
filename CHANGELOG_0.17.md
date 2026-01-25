## Bug fixes / improvements to document
[x] In order to enable uWebSockets.js - you need to install either `uwebsockets-express@^1.4.1` (for express v4) or `uwebsockets-express@^2.0.1` (for express v5)
[x] `LobbyRoom` / `enableRealtimeListing()`: fix removing room from lobby listing when room is disposed.
[x] Room's protected members are now `private` for better DX. If you are using one of the undocumented protected methods, such as `resetAutoDisposeTimeout`, you can call it via `this['resetAutoDisposeTimeout']()`.
[x] The `.setSeatReservationTime()` method has been moved to `.seatReservationTimeout=` property.
[ ] The `Room` type has changed from `Room<State, Metadata>` to `Room<{ state?: MyState, metadata?: Metadata, client?: CustomClient }>`.
[ ] Room's presence pub/sub now can unsubscribe themselves during `onDispose()`
[ ] `.allowReconnection()` breaking changes. (https://github.com/colyseus/colyseus/issues/893)
  [ ] `onLeave(client, code)` - the onLeave now receives close `code` as number instead of `consented` boolean flag.
[ ] `Protocol.WS_*` close codes have been moved to `CloseCode.*`
[ ] Introduced `CloseCode.SERVER_SHUTDOWN`
[ ] Skipping handshake when local state is available (when reconnecting or with concrete state provided)
[ ] Fixed bug where setting `patchRate=0` would stop `clock` intervals and timeouts from working (https://github.com/colyseus/colyseus/issues/869)
[ ] Playground: Automatically-generated postman-like UI
[ ] Introduce `maxMessagesPerSecond` for rate-limiting room messages (forcibly close if client exceeds threshold)
[ ] New `room.ping(callback)` method.
[ ] Introduce `ColyseusSDK.selectByLatency(endpoints)` and `sdk.getLatency()`
[x] `LobbyRoom`: no need to manually call `updateLobby()` when calling `.setMetadata()` anymore. This is done automatically for you.

## Changes on `@colyseus/schema`

[ ] `$refId` is now accessible both on client-side and server-side via `instance[$refId]`
[ ] Encoder uses and expects `Uint8Array` instead of `Buffer` (compatibility with web browsers)
[ ] Add Unity-like schema callbacks for TypeScript

## New features to document

[ ] `@colyseus/tools`: New `routes` and `rooms` options
[ ] `@colyseus/core`: New `defineServer()` option
[ ] Introduced `.setMatchmaking()` for batch modifying the listing entry of the room on the matchmaking driver. Allows to modify `metadata`, `locked`, `maxClients`, etc in a single operation.
[ ] Document `QueueRoom` and its usage example: https://github.com/endel/colyseus-ranked-matchmaking/?tab=readme-ov-file#ranked-queue-with-colyseus
[ ] `@colyseus/sdk/debug` - New embedded realtime debug/inspector for rooms. On Unity available at **Window → Colyseus → Room Inspector**.


## onMessage with raw bytes

We have separate methods now for handling `onMessage()` with raw bytes: `onMessageBytes()`

## HTTP Error Codes on Matchmaking Routes

`MATCHMAKE_NO_HANDLER`: 4210 => 520
`MATCHMAKE_INVALID_CRITERIA`: 4211 => 521
`MATCHMAKE_INVALID_ROOM_ID`: 4212 => 522
`MATCHMAKE_UNHANDLED`: 4213 => 523
`MATCHMAKE_EXPIRED`: 4214 => 524

## TODO:

[x] PostgreSQL match-making driver
[x] debug:* logs should go to STDOUT (not STDERR)
[x] `RoomCache`: remove mongodb-like methods like `.updateOne()`, `save()`, and `remove()`
[x] Check why this test outputs `Error: UNDEFINED_VALUE` for `PostgresDriver`: `npm test -- --grep 'should not exceed maxClients'`
[x] `RoomCache`: improve metadata handling and filters
[x] Colyseus Cloud: allow `@colyseus/tools` - `listen()` method to accept a raw `server` instance and make it compatible with Colyseus Cloud infrastructure.
[x] Full-stack type safety
[x] Support Express v5
[x] Check if `@colyseus/testing` is working properly.
[x] `PostgresDriver`: confirm if delay between increment/decrement `clients` is affecting `maxClients` being respected.
[ ] Automatic room connection recovery. Should cover Covers abnormal closure and wi-fi network change. (https://canary.discord.com/channels/525739117951320081/1408832885149929714/1408832885149929714)
[ ] How to use new `messages = {}` for raw binary data? (`.onMessageBytes()` ??, maybe using `binary()` utility?)
[ ] Drivers: Allow to filter with OR operation (metaField=X or metaField=Y)
[ ] Room caching and restoration ("migration") to new server
[ ] `RedisDriver`: implement `boot()` to create LUA Script for filtering rooms at the server instead of at the Redis client (currently under `redis-driver/src/experimental_luaScripts/*` directory. tho performance is worse than current implementation.)