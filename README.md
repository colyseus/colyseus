# ![colyseus](examples/logo.png?raw=true)

[![Join the chat at https://gitter.im/gamestdio/colyseus](https://badges.gitter.im/Join%20Chat.svg)](https://gitter.im/gamestdio/colyseus?utm_source=badge&utm_medium=badge&utm_campaign=pr-badge&utm_content=badge)
[![Build Status](https://secure.travis-ci.org/gamestdio/colyseus.png?branch=master)](http://travis-ci.org/gamestdio/colyseus)

Minimalistic MMO Game Server for Node.js.

**Live demos:**

- [Colyseus React Example](https://colyseus-react-example.herokuapp.com)
- [CubeClub Soccer](http://cubeclub.gamestd.io)

## Features

- WebSocket-based communication
- Match-making
- Binary data transfer (through [msgpack](http://msgpack.org))
- Delta-encoded state broadcasts (through [fast-json-patch](https://github.com/Starcounter-Jack/JSON-Patch/) - [RFC6902](http://tools.ietf.org/html/rfc6902))

TODO:

- delay/lag compensation
- "area of interest" updates/broadcasts

## Room API

### Callbacks

- onJoin (client) - *when a client joins the room*
- onLeave (client) - *when a client leaves the room*
- onMessage (client, data) - *when a client send a message*
- update () - *update method, usually to broadcast patch state*
- dispose () - *cleanup callback, called after there's no more clients on the room*

### Methods

- lock() - *lock the room to new clients*
- unlock() - *unlock the room to new clients*
- send(client, data) - *send data to a particular client*
- broadcast(data) - *send data to all connected clients*
- sendState(client) - *send current state to a particular client*
- broadcastState() - *send current state to all clients*
- broadcastPatch() - *send patched (diff) state to all clients*

## Production usage

It's recommended to use a [process manager](https://github.com/Unitech/pm2) to ensure the server will reload in
case your application goes down.

```
pm2 start server.js --node-args="--harmony"
```

## Options to consider

node --optimize_for_size --max_old_space_size=920 --gc_interval=100 server.js

## License

MIT
