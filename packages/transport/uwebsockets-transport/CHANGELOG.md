# Changelog

## 0.17.21

- Fix process-wide crash (`ERR_UNHANDLED_ERROR`) when an HTTP request body is incomplete or arrives too slowly — remotely triggerable by advertising a `Content-Length` and withholding the body. Such requests are now answered with `408 Request Timeout` and the server stays operational. Works with currently published `uwebsockets-express` versions (colyseus/uWebSockets-express#43, thanks to @pierroo)
- Add `readBodyMaxTime` transport option: maximum time (in milliseconds) allowed while reading an HTTP request body before responding `408` (default: `500`). Previously this limit was hard-coded and could not be configured through the transport.

## 0.17.20

- Use `MAY_TRY_RECONNECT` close code (instead of `FAILED_TO_RECONNECT`) in devMode when a reconnection token is present but the seat hasn't been reserved yet. This allows the SDK to retry during the brief HMR reload window.

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

