/**
 * Colyseus Vite Plugin
 *
 * Integrates a Colyseus game server into Vite's dev server and build pipeline.
 *
 * ## Architecture
 *
 * Colyseus packages are externalized in the runner environment so they share
 * the same module instances — and therefore the same matchMaker singleton —
 * as the plugin process. This lets user code (monitor, playground, custom
 * middleware) access the real matchMaker with actual room data.
 *
 * In dev mode, defineServer() returns a config-only object (no Server
 * instance). The plugin manages the matchMaker lifecycle, transport, and
 * HMR directly.
 *
 * On HMR:
 * 1. Re-import user module (defineServer returns fresh config)
 * 2. Swap router handler + re-register room definitions
 * 3. matchMaker.hotReload() — cache rooms, dispose, restore
 */
import * as matchMaker from '@colyseus/core/MatchMaker';
import {
  setDevMode,
  createNodeMatchmakingMiddleware,
  dynamicImport,
  registerRoomDefinitions,
  unregisterRoomDefinitions,
  toNodeHandler,
  type RoomDefinitions,
  type ServerOptions,
  type Transport,
  type Router,
} from '@colyseus/core';
import { setTransport } from '@colyseus/core/Transport';
import type { Plugin } from 'vite';

// ─── Virtual module IDs ───────────────────────────────────────────────

const VIRTUAL_SERVER_ENTRY = 'virtual:colyseus-server-entry';
const RESOLVED_VIRTUAL_SERVER_ENTRY = '\0' + VIRTUAL_SERVER_ENTRY;

// ─── Options ──────────────────────────────────────────────────────────

export interface ColyseusViteOptions {
  serverEntry: string;
  port?: number;
  quiet?: boolean;
  /**
   * Serve the built client files via express.static() in the production
   * server entry. Adds a SPA fallback that serves index.html for
   * unmatched GET requests.
   *
   * Has no effect in dev mode (Vite serves the frontend).
   */
  serveClient?: boolean;
  loadWsTransport?: () => Promise<{
    WebSocketTransport: new (options?: any) => Transport & {
      attachToServer(server: any, options?: { filter?: (req: any) => boolean }): any;
    };
  }>;
}

// ─── Internal types ───────────────────────────────────────────────────

type ServerConfig = {
  options?: ServerOptions;
  router?: Router;
  '~rooms'?: RoomDefinitions;
};

type ServerModule = {
  server?: ServerConfig;
  rooms?: RoomDefinitions;
  default?: {
    server?: ServerConfig;
    rooms?: RoomDefinitions;
  };
};

// ─── Helpers ──────────────────────────────────────────────────────────

function getServerExport(mod: ServerModule): ServerConfig | undefined {
  return mod.server || mod.default?.server;
}

function getRoomsExport(mod: ServerModule): RoomDefinitions | undefined {
  return mod.rooms || mod.default?.rooms;
}

// ─── Virtual module generators ────────────────────────────────────────

/**
 * Production build entry — standalone server that imports the user's
 * server entry and calls `server.listen()`.
 */
export function createColyseusViteServerEntry(options: ColyseusViteOptions) {
  const port = options.port ?? 2567;

  const lines: string[] = [
    `import { Server, registerRoomDefinitions } from "colyseus";`,
  ];

  if (options.serveClient) {
    lines.push(
      `import express from "express";`,
      `import { fileURLToPath } from "url";`,
      `import { dirname, join } from "path";`,
      ``,
      `const __dirname = dirname(fileURLToPath(import.meta.url));`,
      `const clientDir = join(__dirname, "../client");`,
    );
  }

  lines.push(
    ``,
    `const entry = await import(${JSON.stringify(options.serverEntry)});`,
    `const server = entry.server ?? entry.default?.server;`,
    `const rooms = entry.rooms ?? entry.default?.rooms;`,
    ``,
    `if (server) {`,
  );

  if (options.serveClient) {
    lines.push(
      `  await server["_onTransportReady"];`,
      `  if (server.transport.getExpressApp) {`,
      `    const app = server.transport.getExpressApp();`,
      `    app.use(express.static(clientDir));`,
      `    app.get("*all", (req, res) => res.sendFile(join(clientDir, "index.html")));`,
      `  }`,
    );
  }

  lines.push(
    `  server.listen(${port});`,
    `} else if (rooms) {`,
    `  const gameServer = new Server();`,
    `  registerRoomDefinitions(rooms);`,
    `  gameServer.listen(${port});`,
    `} else {`,
    `  throw new Error('[colyseus] Server entry should export \`server = defineServer(...)\` or \`rooms\`.');`,
    `}`,
  );

  return lines.join('\n');
}

// ─── Exported helpers (for testing) ───────────────────────────────────

export async function reloadColyseusViteRooms(
  importModule: (specifier: string) => Promise<any>,
  serverEntry: string,
  currentRoomNames: string[] = [],
) {
  const mod = await importModule(serverEntry);

  unregisterRoomDefinitions(currentRoomNames);

  const server = getServerExport(mod);
  const rooms: RoomDefinitions | undefined = getRoomsExport(mod)
    || server?.['~rooms'];

  if (!rooms) {
    return {
      roomNames: [],
      hasRooms: false,
      server,
    };
  }

  return {
    roomNames: registerRoomDefinitions(rooms),
    hasRooms: true,
    server,
  };
}

// ─── Plugin ───────────────────────────────────────────────────────────

export function colyseus(options: ColyseusViteOptions): Plugin[] {
  let viteServer: any;
  let currentRoomNames: string[] = [];
  let currentAppHandler: ((req: any, res: any, next: any) => void) | null = null;
  let expressApp: any = null;
  let isStarted = false;

  return [
    {
      name: 'colyseus:config',
      config() {
        return {
          builder: {},
          build: { outDir: 'dist/client' },
          environments: {
            colyseus: {
              consumer: 'server' as const,
              resolve: {
                // Externalize all dependencies so they share the same module
                // instances (and matchMaker singleton) with the plugin process.
                // Without this, Vite re-evaluates workspace/linked packages in
                // the runner, creating isolated singletons — breaking monitor, etc.
                external: true,
              },
              build: {
                outDir: 'dist/server',
                ssr: true,
                rollupOptions: {
                  input: VIRTUAL_SERVER_ENTRY,
                  output: { entryFileNames: 'server.mjs' },
                },
              },
            },
          },
        };
      },
      resolveId(id: string) {
        if (id === VIRTUAL_SERVER_ENTRY) { return RESOLVED_VIRTUAL_SERVER_ENTRY; }
      },
      load(id: string) {
        if (id === RESOLVED_VIRTUAL_SERVER_ENTRY) {
          return createColyseusViteServerEntry(options);
        }
      },
    },

    {
      name: 'colyseus:dev-server',
      configureServer(server: any) {
        viteServer = server;
        server.middlewares.use(createNodeMatchmakingMiddleware());

        // Dynamic application middleware — handler is swapped on each HMR reload.
        server.middlewares.use((req: any, res: any, next: any) => {
          if (!currentAppHandler) { return next(); }
          currentAppHandler(req, res, next);
        });

        return async () => {
          if (!server.httpServer) {
            throw new Error('[colyseus] Vite HTTP server not available.');
          }
          await loadServerModule();
          console.log("[colyseus] Server ready on Vite's HTTP server");
        };
      },
    },

    {
      name: 'colyseus:hmr',
      hotUpdate({ file, modules }) {
        if (this.environment?.name === 'colyseus' && modules.length > 0) {
          loadServerModule().then(() => {
            if (!options.quiet) {
              console.log(`[colyseus] Server code reloaded (${file})`);
            }
          }).catch((e) => {
            console.error('[colyseus] Failed to reload server module:', e);
          });
        }
      },
    },
  ];

  /**
   * Import (or re-import) the user's server entry and configure the
   * matchMaker, transport, rooms, and middleware.
   *
   * On initial load: sets up matchMaker, creates transport, registers rooms.
   * On HMR reload: re-imports user code, swaps rooms/router, hot-reloads
   * running rooms (cache → dispose → restore).
   */
  async function loadServerModule() {
    const env = viteServer.environments.colyseus;
    if (!env) {
      console.error('[colyseus] Environment not found');
      return;
    }

    try {
      // Clear the runner's evaluated module cache so re-import picks up
      // fresh user code. External packages (@colyseus/*) are cached by
      // Node's module system — they keep their singleton state.
      if (isStarted && env.runner.evaluatedModules) {
        env.runner.evaluatedModules.clear();
      }

      // ── Step 1: Set up matchMaker + transport (initial load only) ──
      if (!isStarted) {
        setDevMode(true);
        await matchMaker.setup();

        const wsModule = await (options.loadWsTransport
          ? options.loadWsTransport()
          : dynamicImport<typeof import('@colyseus/ws-transport')>('@colyseus/ws-transport'));

        const transport = new wsModule.WebSocketTransport({ noServer: true });

        if (typeof (transport as any).attachToServer !== 'function') {
          throw new Error('[colyseus] Vite dev mode requires a transport with attachToServer().');
        }

        (transport as any).attachToServer(viteServer.httpServer, {
          filter(req: any) {
            return /^\/[a-zA-Z0-9_-]+\/[a-zA-Z0-9_-]+\/?$/.test(
              new URL(req.url || '', 'http://localhost').pathname,
            );
          },
        });
        setTransport(transport);
      }

      // ── Step 2: Import user module ──
      // In dev mode, defineServer() returns a config object (no Server
      // instance, no matchMaker.setup() call) because isDevMode is true.
      const mod = await env.runner.import(options.serverEntry);

      const config = getServerExport(mod);
      const rooms: RoomDefinitions | undefined = getRoomsExport(mod)
        || config?.['~rooms'];

      // ── Step 3: Build application middleware (router + express) ──
      const router = config?.router;

      // Set up express once — persistent across HMR reloads.
      if (!expressApp && config?.options?.express) {
        try {
          const express = (await dynamicImport<any>('express')).default;
          expressApp = express();
          config.options.express(expressApp);
        } catch (e) {
          console.warn('[colyseus] Express not available. Install express to use the express option.');
        }
      }

      // Build combined handler: router (hot-swappable) + express (persistent).
      if (router || expressApp) {
        const routerHandler = router ? toNodeHandler(router.handler) : null;
        currentAppHandler = (req: any, res: any, next: any) => {
          if (router?.findRoute(req.method, req.url?.split('?')[0]) !== undefined) {
            routerHandler!(req, res);
          } else if (expressApp) {
            expressApp(req, res, next);
          } else {
            next();
          }
        };
      } else {
        currentAppHandler = null;
      }

      // ── Step 4: Register room definitions ──
      // Must happen BEFORE hotReload() because reloadFromCache() needs
      // the new handlers to recreate room instances.
      unregisterRoomDefinitions(currentRoomNames);
      if (rooms) {
        currentRoomNames = registerRoomDefinitions(rooms);
      } else {
        currentRoomNames = [];
        console.warn(
          '[colyseus] Server entry should export `server = defineServer(...)` or `rooms`.',
        );
      }

      // ── Step 5: Accept connections or hot-reload rooms ──
      if (!isStarted) {
        await matchMaker.accept();
        isStarted = true;
      } else {
        await matchMaker.hotReload();
      }

      if (!options.quiet) {
        for (const roomName of currentRoomNames) {
          console.log(`[colyseus] Room defined: "${roomName}"`);
        }
      }

    } catch (e) {
      console.error('[colyseus] Failed to load server module:', e);
    }
  }
}
