# ![colyseus](examples/logo.png?raw=true)

Minimalist MMO Game Server for Node.js.

> Colyseus is in early stage development. Don't expect a mature and
> ready-to-scale piece of software here

## Features

- WebSocket-based communication
- Match-making
- Binary data transfer (through [msgpack](http://msgpack.org))

TODO:

- "area of interest" updates/broadcasts
- "delta-encoding"

## Production usage

- [PM2](https://github.com/Unitech/pm2)

https://devcenter.heroku.com/articles/node-best-practices
http://pm2.keymetrics.io/docs/usage/specifics/#babeljs

## Options to consider

node --optimize_for_size --max_old_space_size=920 --gc_interval=100 server.js

Game Server inspiration implementation references:

- https://www.cs.cmu.edu/~ashu/papers/cmu-cs-05-112.pdf
- http://dev.louiz.org/projects/batajelo/wiki/Server_architecture
- https://cloud.google.com/solutions/gaming/dedicated-server-gaming-solution/
