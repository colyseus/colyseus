# ![colyseus](examples/logo.png?raw=true)

[![Join the chat at https://gitter.im/gamestdio/colyseus](https://badges.gitter.im/Join%20Chat.svg)](https://gitter.im/gamestdio/colyseus?utm_source=badge&utm_medium=badge&utm_campaign=pr-badge&utm_content=badge)
[![Build Status](https://secure.travis-ci.org/gamestdio/colyseus.png?branch=master)](http://travis-ci.org/gamestdio/colyseus)

Minimalist Multiplayer Game Server for Node.js. [View documentation](http://gamestd.io/colyseus/docs).

**Live demos:**

- [tanx](https://playcanvas.com/project/367035/overview/tanxcolyseus) ([source-code](https://github.com/endel/tanx))
- [tic-tac-toe](https://tictactoe-colyseus.herokuapp.com) ([source-code](https://github.com/endel/tic-tac-toe))
- [LD35 entry: dotower](http://ludumdare.com/compo/ludum-dare-35/?action=preview&uid=50958) ([source-code](https://github.com/endel/LD35))
- [React Example](https://colyseus-react-example.herokuapp.com) ([source-code](https://github.com/endel/colyseus-react-example))

## Features

- WebSocket-based communication
- Room instantiation
- Binary data transfer (through [msgpack](http://msgpack.org))
- Delta-encoded state broadcasts (through [fast-json-patch](https://github.com/Starcounter-Jack/JSON-Patch/) - [RFC6902](http://tools.ietf.org/html/rfc6902))
- Lag compensation (using [timeframe](http://github.com/gamestdio/timeframe), a
  Timeline implementation)
  - _(Not automatic. You should apply the technique as you need, in the client and/or the server.)_

TODO:

- "area of interest" updates/broadcasts

---

**Room instantiation diagram:**

![Room instantiation diagram](http://www.gliffy.com/go/publish/image/10069321/L.png)

**Room state diagram:**

![Room state diagram](http://www.gliffy.com/go/publish/image/10069469/L.png)

## Room API

### Properties

- clock - *A [`ClockTimer`](https://github.com/gamestdio/clock-timer.js) instance*
- timeline - *A [`Timeline`](https://github.com/gamestdio/timeframe) instance (see `useTimeline`)*
- clients - *Array of connected clients*

### Methods you should implement

- onJoin (client) - *When a client joins the room*
- onLeave (client) - *When a client leaves the room*
- onMessage (client, data) - *When a client send a message*
- onDispose () - *Cleanup callback, called after there's no more clients on the room*

### Available methods

- setState( object ) - *Set the current state to be broadcasted / patched.*
- setSimulationInterval( callback[, milliseconds=16.6] ) - *(Optional) Create the simulation interval that will change the state of the game. Default simulation interval: 16.6ms (60fps)*
- setPatchRate( milliseconds ) - *Set frequency the patched state should be sent to all clients. Default is 50ms (20fps).*
- useTimeline([ maxSnapshots=10 ]) - *(Optional) Keep state history between broadcatesd patches.*
- send( client, data ) - *Send data to a particular client.*
- lock() - *Lock the room to new clients.*
- unlock() - *Unlock the room to new clients.*
- broadcast( data ) - *Send data to all connected clients.*
- disconnect() - *Disconnect all clients then dispose.*

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
