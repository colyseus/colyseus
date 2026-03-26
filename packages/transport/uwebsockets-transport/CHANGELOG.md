# Changelog

## 0.17.19

- Enqueue messages sent during `onReconnect()`, ensuring they arrive after the client completes the reconnection handshake.
- Fix `Invalid access of closed uWS.WebSocket/SSLWebSocket` crash when socket closes before deferred `error()` callback fires (#925)

## 0.17.18

- Fix `Invalid access of closed uWS.WebSocket/SSLWebSocket` crash when socket closes before deferred `error()` callback fires (#925)

## 0.17.17

- Fix `uWS.HttpResponse must not be accessed after onAborted callback` error when client disconnects during Express-handled requests (#924)

## 0.17.16

- Fix `HPE_UNEXPECTED_CONTENT_LENGTH` error (#908), thanks to @lkinasiewicz

## 0.17.15

- Fix express and auth routes hanging. Use `@colyseus/better-auth` version that exposes `.findRoute()`.

## 0.17.14

- Fix order of header write order on HTTP requests, which was conflicting with `serve-index` Express module.

