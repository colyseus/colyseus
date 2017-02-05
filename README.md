# ![colyseus](media/header.png?raw=true)

> Multiplayer Game Server for Node.js. [View documentation](https://github.com/gamestdio/colyseus/wiki).

[![Join the chat at https://gitter.im/gamestdio/colyseus](https://badges.gitter.im/Join%20Chat.svg)](https://gitter.im/gamestdio/colyseus?utm_source=badge&utm_medium=badge&utm_campaign=pr-badge&utm_content=badge)
[![Build Status](https://secure.travis-ci.org/gamestdio/colyseus.png?branch=master)](http://travis-ci.org/gamestdio/colyseus)


Read the [blog post](https://medium.com/@endel/colyseus-minimalistic-mmo-game-server-for-node-js-a29fe1cebbfe) to understand the motivation behind this project.

## Features / Characteristics

- WebSocket-based communication
- Binary delta compressed state (through [msgpack](http://msgpack.org) / [fossil-delta-js](https://github.com/dchest/fossil-delta-js))
- Match-making
- Custom room handlers
- Lag compensation (using [timeframe](http://github.com/gamestdio/timeframe), a
  Timeline implementation) - Not automatic. You should apply the technique as you need, in the client and/or the server.

### Client integration

- [JavaScript/TypeScript](https://github.com/gamestdio/colyseus.js)
- [Construct2](https://github.com/polpoy/colyseus-construct-plugin)
- [Unity3d](https://github.com/gamestdio/colyseus-unity3d) (works only with server v0.3.x)
- [CoronaSDK](https://github.com/gamestdio/colyseus.lua) (works only with server v0.3.x)

### Usage examples

- [Official Examples](https://github.com/gamestdio/colyseus-examples) - Official examples for learning purposes.
- [tanx](https://playcanvas.com/project/367035/overview/tanxcolyseus) ([source-code](https://github.com/endel/tanx)) - Multiplayer tanks game, originally from [PlayCanvas](https://tanx.io/)
- [tic-tac-toe](https://tictactoe-colyseus.herokuapp.com) ([source-code](https://github.com/endel/tic-tac-toe)) - Simple Tic Tac Toe using [pixi.js](https://github.com/pixijs/pixi.js)
- [LD35 entry: dotower](http://ludumdare.com/compo/ludum-dare-35/?action=preview&uid=50958) ([source-code](https://github.com/endel/LD35)) - Simple experimental MOBA using [pixi.js](https://github.com/pixijs/pixi.js)
- [React Example](https://colyseus-react-example.herokuapp.com) ([source-code](https://github.com/endel/colyseus-react-example)) - Example integrating with [ReactJS](https://github.com/facebook/react) state

---

## Room handler API

### Room properties

- clock - *A [`ClockTimer`](https://github.com/gamestdio/clock-timer.js) instance*
- timeline - *A [`Timeline`](https://github.com/gamestdio/timeframe) instance (see `useTimeline`)*
- clients - *Array of connected clients*

### Abstract methods

Room handlers must implement all these methods.

- onJoin (client) - *When a client joins the room*
- onLeave (client) - *When a client leaves the room*
- onMessage (client, data) - *When a client send a message*
- onDispose () - *Cleanup callback, called after there's no more clients on the room*

### Methods:

Room handlers have these methods available.

- setState( object ) - *Set the current state to be broadcasted / patched.*
- setSimulationInterval( callback[, milliseconds=16.6] ) - *(Optional) Create the simulation interval that will change the state of the game. Default simulation interval: 16.6ms (60fps)*
- setPatchRate( milliseconds ) - *Set frequency the patched state should be sent to all clients. Default is 50ms (20fps).*
- useTimeline([ maxSnapshots=10 ]) - *(Optional) Keep state history between broadcatesd patches.*
- send( client, data ) - *Send data to a particular client.*
- lock() - *Lock the room to new clients.*
- unlock() - *Unlock the room to new clients.*
- broadcast( data ) - *Send data to all connected clients.*
- disconnect() - *Disconnect all clients then dispose.*


## License

MIT
