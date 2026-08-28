# Changelog

## 0.18.5

- `vite dev`: `@colyseus/database`, `@colyseus/auth` and `beforeListen` now work — rooms using database plugins threw on join before, and `/auth/*` answered 404.

- An HMR reload rebuilds your `database`, so the plugin boots the new instance and closes the one it replaced — every save used to leak a connection.

## 0.18.4

- The Vite plugin now finds your server even when the entry doesn't export it under the name `server` — `const gameServer = defineServer(...)`, as the non-Vite docs spell it, previously registered no rooms and warned that the entry should export `server` or `rooms`.

- Ctrl-C on the dev server now shuts Colyseus down gracefully, running your `onBeforeShutdown`/`onShutdown` callbacks and caching room state for the next restart.

## 0.18.2

- Fix `require("colyseus")` throwing `ERR_INVALID_ARG_TYPE` before any user code ran, which broke every CommonJS project — whether or not it used the monitor or playground panels.

- Node.js 22 is now the declared minimum (`engines`).

## 0.18.1

- 0.18 preview refresh. See the `@colyseus/core` and `@colyseus/sdk` 0.18.1 changelogs for the headline work: client-side prediction (`@colyseus/sdk/predict`), fixed timestep (`setFixedTimestep` + `StepContext`), input accessor rework, lag compensation (`allowRewindState`), request/response reply context, TIMED protocol, and reconnect resync.
- WebRTC plugin: signaling relay uses the new `clients.get(sessionId)` (was the now-deprecated `getById`).
- Require `@colyseus/schema` `^5.0.8`.

## 0.17.10

### Vite plugin fixes

- **Fix `express` interop in dev mode.** `(await dynamicImport('express')).default` could resolve to `undefined` in some ESM module-loader setups, causing the plugin to silently fall back to `[colyseus] Express not available. Install express to use the express option.` The plugin now accepts both shapes via `expressModule?.default ?? expressModule`. (thanks @asteinheiser for reporting)
- **Support `server.middlewareMode`.** When Vite is wrapped by a custom parent server (e.g. Express hosting GraphQL alongside the Vite dev middleware), the Colyseus plugin previously threw `[colyseus] Vite HTTP server not available.` because `server.httpServer` is null in middleware mode. A new `httpServer` plugin option lets you pass your own `http.Server` for the WebSocket transport to attach to:

  ```typescript
  import http from 'http';
  import express from 'express';
  import { createServer as createViteServer } from 'vite';
  import { colyseus } from 'colyseus/vite';

  const app = express();
  const httpServer = http.createServer(app);

  const vite = await createViteServer({
    plugins: [
      colyseus({ serverEntry: '/src/server/index.ts', httpServer }),
    ],
    server: { middlewareMode: true },
    appType: 'custom',
  });

  app.use(vite.middlewares);
  httpServer.listen(3000);
  ```

- **Await async `express` callback.** The dev-mode path now awaits `config.options.express(expressApp)` so async setup (e.g. `await apolloServer.start()` before mounting `expressMiddleware`) resolves before any request is served, matching the behavior of `beforeListen`.

## 0.17.9

### Vite Integration

First-class [Vite](https://vite.dev/) plugin that lets you develop and build your multiplayer game from a single config.

```bash
npm install colyseus vite
```

**Setup** — create a `vite.config.ts`:

```typescript
import { defineConfig } from 'vite';
import { colyseus } from 'colyseus/vite';

export default defineConfig({
  plugins: [
    colyseus({
      serverEntry: '/src/server/index.ts',
      serveClient: true,
    }),
  ],
});
```

**Server entry** — define rooms, routes, and middleware in one place:

```typescript
// src/server/index.ts
import { defineServer, defineRoom, createRouter, createEndpoint, monitor } from 'colyseus';
import { MyRoom } from './MyRoom';

export const server = defineServer({
  rooms: {
    my_room: defineRoom(MyRoom),
  },

  express: (app) => {
    app.use('/monitor', monitor());
  },

  routes: createRouter({
    hello: createEndpoint("/hello", { method: "GET" }, async (ctx) => {
      return { message: "Hello world!" };
    }),
  }),
});
```

Run `npx vite` — client and game server on the same port, no separate process.

**Features:**

- Shares Vite's dev HTTP server — WebSocket upgrades for room connections are filtered and forwarded to the Colyseus transport, everything else stays with Vite.
- `/matchmake/*` endpoints are injected as middleware — client SDK connects to the same origin, no proxy or CORS needed.
- Hot module reloading — edit room classes and see changes immediately. Running rooms preserve state and connected clients auto-reconnect.
- `@colyseus/monitor`, `@colyseus/playground`, and any package importing `matchMaker` work correctly in dev mode.
- `devMode` is automatically enabled unless explicitly set to `false` in `defineServer()`.

**Production builds:**

```bash
npx vite build --app
```

Produces `dist/client/` (static assets) and `dist/server/server.mjs` (standalone Node.js entry).

When `serveClient: true` is set, the production server automatically serves the built client files via `express.static()` with SPA fallback — deploy as a single process:

```bash
node dist/server/server.mjs
```

**Plugin options:**

- `serverEntry` (required) — path to your server entry module.
- `port` — port for the production server (default: `2567`).
- `serveClient` — serve built client files in production via `express.static()` with SPA fallback (default: `false`).
- `quiet` — suppress per-reload log messages during development.
- `loadWsTransport` — custom transport loader (advanced).

## 0.17.8

- Initial changelog entry
