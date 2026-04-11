# Changelog

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
