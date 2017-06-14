# Migrating between versions of Colyseus

## Migrating from 0.4 to 0.5

#### Use `ClusterServer` instead of `Server`:

The `ClusterServer` will take care of forwarding connections to child processes. Even if you're running in a single-core machine, you should now use it. See usage example in [usage/ClusteredServer.ts](usage/ClusteredServer.ts)

You can still define and use your own HTTP routes and middlewares in the worker processes.

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
