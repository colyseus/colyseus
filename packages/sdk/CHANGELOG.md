# Changelog

## 0.17.34

- Bundle `dist/colyseus.js` file with latest `@colyseus/schema` version.

## 0.17.33

- Fix `debug.js` panel to intercept all `consumeSeatReservation()` calls.

## 0.17.32

- Fix `debug.js` panel text color. (#910, thanks @Andrek25)

## 0.17.31

- Fix `debug.js` panel text color. (#909, thanks @Andrek25)

## 0.17.30

- Throw error if requesting to join a room without a room name.
- Fix `e.code` of `client.http.*` errors to always be a number.

## 0.17.29

- Fix `dist/debug.js` build to be embedded via CDN (e.g. `https://unpkg.com/@colyseus/sdk@^0.17.0/dist/debug.js`)

## 0.17.28

- fix displaying correct error message on `ServerError` / `MatchMakeError`

## 0.17.27

- Fix forwarding `?skipHandshake=1` query param if concrete state has been provided.

