# Migrating between versions of Colyseus

## Migrating from 0.4 to 0.5

#### Use `Server#listen` to bind http port.

The `Server` is now using the `ClusterServer` under the hood, which will spawn
workers automatically. If you're using the `Server` instead of `ClusterServer`
directly, you should call its `listen` method.

OLD

```
import { createServer } from 'http';
import { Server } from 'colyseus';
const httpServer = createServer(app);
const gameServer = new Server({ server: httpServer });
httpServer.listen(2657);
```

NEW

```
import { createServer } from 'http';
import { Server } from 'colyseus';
const httpServer = createServer(app);
const gameServer = new Server({ server: httpServer });
gameServer.listen(2657); // calling 'listen' from gameServer instead of httpServer
```

#### `constructor` signature changed. use `onInit` instead.

OLD

```
constructor (options) {
  super(options);
  // ... initialize the room
}
```

NEW

```
constructor () {
  // room has been constructed. no options available yet!
}

onInit (options) {
  // ... initialize the room
}
```

#### `requestJoin` - can return type can be either `boolean` or `number` (`0..1`)

OLD

```
requestJoin (options) {
  // accept connections if this room is not full.
  return this.clients.length < 10;
}
```

NEW

```
requestJoin (options) {
  // give priority to connect on rooms with fewer clients.
  return 1 - (this.clients.length) / 10;
}
```

#### use `patchRate` property instead of `setPatchRate()` method.

OLD

```
constructor (options) {
  this.setPatchRate(1000 / 50);
}
```

NEW

```
class MyRoom extends Room {
  patchRate = 1000 / 50;
}
```

#### `client.id` / `client.sessionId`

- `client.sessionId` - is a unique identifier of a user connected in a room.
- `client.id` - is a unique identifier of a user. if the user connects to the same room twice, you can identify he has two sessions by checking for `client.id`. If you don't bother having the same user connected multiple times in a room, always use `client.sessionId` to identify it.

#### new `room.maxClients` property.

OLD - if you're just checking for `client.length` on `requestJoin`, you probably can switch to `maxClients` instead.

```
requestJoin (options) {
  return this.clients.length < 10;
}
```

NEW

```
class MyRoom extends Room {
  maxClients = 10;
}
```

## Migrating from 0.3 to 0.4

#### constructor / patch-rate

OLD constructor / patch-rate

```
class MyRoom extends Room {
  constructor ( options ) {
    super( options, PATH_RATE )
  }
}
```

NEW constructor / patch-rate

```
class MyRoom extends Room {
  constructor ( options ) {
    super( options )
    this.setPatchRate( PATCH_RATE )
  }
}
```
