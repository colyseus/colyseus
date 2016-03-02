# ![colyseus](examples/logo.png?raw=true)

[![Join the chat at https://gitter.im/gamestdio/colyseus](https://badges.gitter.im/Join%20Chat.svg)](https://gitter.im/gamestdio/colyseus?utm_source=badge&utm_medium=badge&utm_campaign=pr-badge&utm_content=badge)
[![Build Status](https://secure.travis-ci.org/gamestdio/colyseus.png?branch=master)](http://travis-ci.org/gamestdio/colyseus)

Minimalistic MMO Game Server for Node.js. [View documentation](http://gamestd.io/colyseus/docs).

**Live demos:**

- [tanx](https://playcanvas.com/project/367035/overview/tanxcolyseus) ([source-code](https://github.com/endel/tanx))
- [tic-tac-toe](https://tictactoe-colyseus.herokuapp.com) ([source-code](https://github.com/endel/tic-tac-toe))
- [React Example](https://colyseus-react-example.herokuapp.com) ([source-code](https://github.com/endel/colyseus-react-example))

## Features

- WebSocket-based communication
- Match-making
- Binary data transfer (through [msgpack](http://msgpack.org))
- Delta-encoded state broadcasts (through [fast-json-patch](https://github.com/Starcounter-Jack/JSON-Patch/) - [RFC6902](http://tools.ietf.org/html/rfc6902))

TODO:

- delay/lag compensation
- "area of interest" updates/broadcasts

---

**Match-making diagram:**

![Match-making diagram](http://www.gliffy.com/go/publish/image/10069321/L.png)

**Room state diagram:**

![Room state diagram](http://www.gliffy.com/go/publish/image/10069469/L.png)

## Room API

### Callbacks

- onJoin (client) - *when a client joins the room*
- onLeave (client) - *when a client leaves the room*
- onMessage (client, data) - *when a client send a message*
- dispose () - *cleanup callback, called after there's no more clients on the room*

### Methods

- lock() - *lock the room to new clients*
- unlock() - *unlock the room to new clients*
- send(client, data) - *send data to a particular client*
- broadcast(data) - *send data to all connected clients*
- sendState(client) - *send current state to a particular client*
- broadcastState() - *send current state to all clients*
- broadcastPatch() - *send patched (diff) state to all clients* (called
  automatically at configurable interval)
- disconnect() - *disconnect all clients then dispose*

## Production usage

It's recommended to use a [process manager](https://github.com/Unitech/pm2) to ensure the server will reload in
case your application goes down.

```
pm2 start server.js --node-args="--harmony"
```

Redirect port 80 to target deployment port (e.g. 3000), to avoid running harmful
code as sudoer: ([read more](http://stackoverflow.com/a/16573737/892698))

```
sudo iptables -t nat -A PREROUTING -i eth0 -p tcp --dport 80 -j REDIRECT --to-port 3000
```

## License

MIT
