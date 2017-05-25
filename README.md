# ![colyseus](media/header.png?raw=true)

> Multiplayer Game Server for Node.js. [View documentation](https://github.com/gamestdio/colyseus/wiki).

[![Join the chat at https://gitter.im/gamestdio/colyseus](https://badges.gitter.im/Join%20Chat.svg)](https://gitter.im/gamestdio/colyseus?utm_source=badge&utm_medium=badge&utm_campaign=pr-badge&utm_content=badge)
[![Donate](https://img.shields.io/badge/Donate-PayPal-green.svg)](https://www.paypal.com/cgi-bin/webscr?cmd=_s-xclick&hosted_button_id=N9C36SSE9ZCTS)
[![Build Status](https://secure.travis-ci.org/gamestdio/colyseus.png?branch=master)](http://travis-ci.org/gamestdio/colyseus)
[![OpenCollective](https://opencollective.com/colyseus/backers/badge.svg)](#backers)
[![OpenCollective](https://opencollective.com/colyseus/sponsors/badge.svg)](#sponsors)


Read the [blog post](https://medium.com/@endel/colyseus-minimalistic-mmo-game-server-for-node-js-a29fe1cebbfe) to understand the motivation behind this project.

## Features / Characteristics

- WebSocket-based communication
- Binary delta compressed state (through [msgpack](http://msgpack.org) / [fossil-delta-js](https://github.com/dchest/fossil-delta-js))
- Match-making
- Custom room handlers
- Lag compensation (using [timeframe](http://github.com/gamestdio/timeframe), a
  Timeline implementation) - Not automatic. You should apply the technique as you need, in the client and/or the server.

### Official client integration

- [JavaScript/TypeScript](https://github.com/gamestdio/colyseus.js)
- [Unity](https://github.com/gamestdio/colyseus-unity3d)
- [CoronaSDK](https://github.com/gamestdio/colyseus.lua) (works only with server v0.3.x)

### Community client integration

- [Construct2](https://github.com/polpoy/colyseus-construct-plugin)
- [Cocos2d-x](https://github.com/chunho32/colyseus-cocos2d-x)

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

# Contributing

We encourage you to contribute to Colyseus! Please check out the [Contributing
guide](.github/CONTRIBUTING.md) for guidelines about how to proceed. Join us!

Everyone interacting in Colyseus and its sub-projects' codebases, issue trackers
and chat rooms is expected to follow the [code of conduct](CODE_OF_CONDUCT.md).

## Backers
Support us with a monthly donation and help us continue our activities. [[Become a backer](https://opencollective.com/colyseus#backer)]
<a href="https://opencollective.com/colyseus/backer/0/website" target="_blank"><img src="https://opencollective.com/colyseus/backer/0/avatar.svg"></a>
<a href="https://opencollective.com/colyseus/backer/1/website" target="_blank"><img src="https://opencollective.com/colyseus/backer/1/avatar.svg"></a>
<a href="https://opencollective.com/colyseus/backer/2/website" target="_blank"><img src="https://opencollective.com/colyseus/backer/2/avatar.svg"></a>
<a href="https://opencollective.com/colyseus/backer/3/website" target="_blank"><img src="https://opencollective.com/colyseus/backer/3/avatar.svg"></a>
<a href="https://opencollective.com/colyseus/backer/4/website" target="_blank"><img src="https://opencollective.com/colyseus/backer/4/avatar.svg"></a>
<a href="https://opencollective.com/colyseus/backer/5/website" target="_blank"><img src="https://opencollective.com/colyseus/backer/5/avatar.svg"></a>
<a href="https://opencollective.com/colyseus/backer/6/website" target="_blank"><img src="https://opencollective.com/colyseus/backer/6/avatar.svg"></a>
<a href="https://opencollective.com/colyseus/backer/7/website" target="_blank"><img src="https://opencollective.com/colyseus/backer/7/avatar.svg"></a>
<a href="https://opencollective.com/colyseus/backer/8/website" target="_blank"><img src="https://opencollective.com/colyseus/backer/8/avatar.svg"></a>
<a href="https://opencollective.com/colyseus/backer/9/website" target="_blank"><img src="https://opencollective.com/colyseus/backer/9/avatar.svg"></a>
<a href="https://opencollective.com/colyseus/backer/10/website" target="_blank"><img src="https://opencollective.com/colyseus/backer/10/avatar.svg"></a>
<a href="https://opencollective.com/colyseus/backer/11/website" target="_blank"><img src="https://opencollective.com/colyseus/backer/11/avatar.svg"></a>
<a href="https://opencollective.com/colyseus/backer/12/website" target="_blank"><img src="https://opencollective.com/colyseus/backer/12/avatar.svg"></a>
<a href="https://opencollective.com/colyseus/backer/13/website" target="_blank"><img src="https://opencollective.com/colyseus/backer/13/avatar.svg"></a>
<a href="https://opencollective.com/colyseus/backer/14/website" target="_blank"><img src="https://opencollective.com/colyseus/backer/14/avatar.svg"></a>
<a href="https://opencollective.com/colyseus/backer/15/website" target="_blank"><img src="https://opencollective.com/colyseus/backer/15/avatar.svg"></a>
<a href="https://opencollective.com/colyseus/backer/16/website" target="_blank"><img src="https://opencollective.com/colyseus/backer/16/avatar.svg"></a>
<a href="https://opencollective.com/colyseus/backer/17/website" target="_blank"><img src="https://opencollective.com/colyseus/backer/17/avatar.svg"></a>
<a href="https://opencollective.com/colyseus/backer/18/website" target="_blank"><img src="https://opencollective.com/colyseus/backer/18/avatar.svg"></a>
<a href="https://opencollective.com/colyseus/backer/19/website" target="_blank"><img src="https://opencollective.com/colyseus/backer/19/avatar.svg"></a>
<a href="https://opencollective.com/colyseus/backer/20/website" target="_blank"><img src="https://opencollective.com/colyseus/backer/20/avatar.svg"></a>
<a href="https://opencollective.com/colyseus/backer/21/website" target="_blank"><img src="https://opencollective.com/colyseus/backer/21/avatar.svg"></a>
<a href="https://opencollective.com/colyseus/backer/22/website" target="_blank"><img src="https://opencollective.com/colyseus/backer/22/avatar.svg"></a>
<a href="https://opencollective.com/colyseus/backer/23/website" target="_blank"><img src="https://opencollective.com/colyseus/backer/23/avatar.svg"></a>
<a href="https://opencollective.com/colyseus/backer/24/website" target="_blank"><img src="https://opencollective.com/colyseus/backer/24/avatar.svg"></a>
<a href="https://opencollective.com/colyseus/backer/25/website" target="_blank"><img src="https://opencollective.com/colyseus/backer/25/avatar.svg"></a>
<a href="https://opencollective.com/colyseus/backer/26/website" target="_blank"><img src="https://opencollective.com/colyseus/backer/26/avatar.svg"></a>
<a href="https://opencollective.com/colyseus/backer/27/website" target="_blank"><img src="https://opencollective.com/colyseus/backer/27/avatar.svg"></a>
<a href="https://opencollective.com/colyseus/backer/28/website" target="_blank"><img src="https://opencollective.com/colyseus/backer/28/avatar.svg"></a>
<a href="https://opencollective.com/colyseus/backer/29/website" target="_blank"><img src="https://opencollective.com/colyseus/backer/29/avatar.svg"></a>

## Sponsors
Become a sponsor and get your logo on our README on Github with a link to your site. [[Become a sponsor](https://opencollective.com/colyseus#sponsor)]

<a href="https://opencollective.com/colyseus/sponsor/0/website" target="_blank"><img src="https://opencollective.com/colyseus/sponsor/0/avatar.svg"></a>
<a href="https://opencollective.com/colyseus/sponsor/1/website" target="_blank"><img src="https://opencollective.com/colyseus/sponsor/1/avatar.svg"></a>
<a href="https://opencollective.com/colyseus/sponsor/2/website" target="_blank"><img src="https://opencollective.com/colyseus/sponsor/2/avatar.svg"></a>
<a href="https://opencollective.com/colyseus/sponsor/3/website" target="_blank"><img src="https://opencollective.com/colyseus/sponsor/3/avatar.svg"></a>
<a href="https://opencollective.com/colyseus/sponsor/4/website" target="_blank"><img src="https://opencollective.com/colyseus/sponsor/4/avatar.svg"></a>
<a href="https://opencollective.com/colyseus/sponsor/5/website" target="_blank"><img src="https://opencollective.com/colyseus/sponsor/5/avatar.svg"></a>
<a href="https://opencollective.com/colyseus/sponsor/6/website" target="_blank"><img src="https://opencollective.com/colyseus/sponsor/6/avatar.svg"></a>
<a href="https://opencollective.com/colyseus/sponsor/7/website" target="_blank"><img src="https://opencollective.com/colyseus/sponsor/7/avatar.svg"></a>
<a href="https://opencollective.com/colyseus/sponsor/8/website" target="_blank"><img src="https://opencollective.com/colyseus/sponsor/8/avatar.svg"></a>
<a href="https://opencollective.com/colyseus/sponsor/9/website" target="_blank"><img src="https://opencollective.com/colyseus/sponsor/9/avatar.svg"></a>
<a href="https://opencollective.com/colyseus/sponsor/10/website" target="_blank"><img src="https://opencollective.com/colyseus/sponsor/10/avatar.svg"></a>
<a href="https://opencollective.com/colyseus/sponsor/11/website" target="_blank"><img src="https://opencollective.com/colyseus/sponsor/11/avatar.svg"></a>
<a href="https://opencollective.com/colyseus/sponsor/12/website" target="_blank"><img src="https://opencollective.com/colyseus/sponsor/12/avatar.svg"></a>
<a href="https://opencollective.com/colyseus/sponsor/13/website" target="_blank"><img src="https://opencollective.com/colyseus/sponsor/13/avatar.svg"></a>
<a href="https://opencollective.com/colyseus/sponsor/14/website" target="_blank"><img src="https://opencollective.com/colyseus/sponsor/14/avatar.svg"></a>
<a href="https://opencollective.com/colyseus/sponsor/15/website" target="_blank"><img src="https://opencollective.com/colyseus/sponsor/15/avatar.svg"></a>
<a href="https://opencollective.com/colyseus/sponsor/16/website" target="_blank"><img src="https://opencollective.com/colyseus/sponsor/16/avatar.svg"></a>
<a href="https://opencollective.com/colyseus/sponsor/17/website" target="_blank"><img src="https://opencollective.com/colyseus/sponsor/17/avatar.svg"></a>
<a href="https://opencollective.com/colyseus/sponsor/18/website" target="_blank"><img src="https://opencollective.com/colyseus/sponsor/18/avatar.svg"></a>
<a href="https://opencollective.com/colyseus/sponsor/19/website" target="_blank"><img src="https://opencollective.com/colyseus/sponsor/19/avatar.svg"></a>
<a href="https://opencollective.com/colyseus/sponsor/20/website" target="_blank"><img src="https://opencollective.com/colyseus/sponsor/20/avatar.svg"></a>
<a href="https://opencollective.com/colyseus/sponsor/21/website" target="_blank"><img src="https://opencollective.com/colyseus/sponsor/21/avatar.svg"></a>
<a href="https://opencollective.com/colyseus/sponsor/22/website" target="_blank"><img src="https://opencollective.com/colyseus/sponsor/22/avatar.svg"></a>
<a href="https://opencollective.com/colyseus/sponsor/23/website" target="_blank"><img src="https://opencollective.com/colyseus/sponsor/23/avatar.svg"></a>
<a href="https://opencollective.com/colyseus/sponsor/24/website" target="_blank"><img src="https://opencollective.com/colyseus/sponsor/24/avatar.svg"></a>
<a href="https://opencollective.com/colyseus/sponsor/25/website" target="_blank"><img src="https://opencollective.com/colyseus/sponsor/25/avatar.svg"></a>
<a href="https://opencollective.com/colyseus/sponsor/26/website" target="_blank"><img src="https://opencollective.com/colyseus/sponsor/26/avatar.svg"></a>
<a href="https://opencollective.com/colyseus/sponsor/27/website" target="_blank"><img src="https://opencollective.com/colyseus/sponsor/27/avatar.svg"></a>
<a href="https://opencollective.com/colyseus/sponsor/28/website" target="_blank"><img src="https://opencollective.com/colyseus/sponsor/28/avatar.svg"></a>
<a href="https://opencollective.com/colyseus/sponsor/29/website" target="_blank"><img src="https://opencollective.com/colyseus/sponsor/29/avatar.svg"></a>

## License

MIT
