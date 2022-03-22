# @colyseus/loadtest

Utility tool for load testing Colyseus.

## Demo

[![asciicast](https://asciinema.org/a/229378.svg)](https://asciinema.org/a/229378)

## Usage

Install the tool globally in your system.

```
npm install -g @colyseus/loadtest
```

```
$ colyseus-loadtest --help

Options:
    --endpoint: WebSocket endpoint for all connections (default: ws://localhost:2567)
    --room: room handler name
    --numClients: number of connections to open

Example:
    colyseus-loadtest example/bot.ts --endpoint ws://localhost:2567 --room state_handler
```

## Scripting

You may use either JavaScript or TypeScript for scripting your connections:

- See [JavaScript](example/bot.js) template.
- See [TypeScript](example/bot.ts) template.

See below the methods that are called automatically, if implemented. (They are all optional.)

### `requestJoinOptions (i)`

Should return a plain object containing the options for client connection `i` to join the room provided as an argument.

### `onJoin ()`

Triggered when the client successfully joins in the room.

### `onMessage (message)`

Triggered when the server sends a message to this client, or broadcasts to everyone.

### `onStateChange (state)`

Triggered when the room state changes in the server-side.

### `onLeave ()`

Triggered when the client leaves the room.

### `onError (err)`

Triggered whenever an error has occurred in the room handler.


## License

MIT.
