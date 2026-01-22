import type { IncomingMessage, Server, ServerResponse } from "http";
import { type Endpoint, type Router, type RouterConfig, createRouter as createBetterCallRouter, createEndpoint } from "@colyseus/better-call";
import { toNodeHandler } from "@colyseus/better-call/node";
import { controller } from "../matchmaker/controller.ts";
import pkg from "../../package.json" with { type: "json" };

export {
  createEndpoint,
  createMiddleware,
  createInternalContext,

  // Re-export types needed for declaration emit
  type Router,
  type RouterConfig,
  type Endpoint,
  type EndpointHandler,
  type EndpointOptions,
  type EndpointContext,
  type StrictEndpoint,
} from "@colyseus/better-call";

export { toNodeHandler };

export function bindRouterToServer(server: Server, router: Router) {
  // add default "/__healthcheck" endpoint
  router.addEndpoint(createEndpoint("/__healthcheck", { method: "GET" }, async (ctx) => {
    return new Response("", { status: 200 });
  }));

  // add default "/" route, if not provided.
  const hasRootRoute = Object.values(router.endpoints).some(endpoint => endpoint.path === "/");
  if (!hasRootRoute) {
    router.addEndpoint(createEndpoint("/", { method: "GET" }, async (ctx) => {
      return new Response(`Colyseus ${pkg.version}`, { status: 200 });
    }));
  }

  // check if the server is bound to an express app
  const expressApp: any = server.listeners('request').find((listener: Function) =>
    listener.name === "app" && listener['mountpath'] === '/');

  // main router handler
  let next: Function = toNodeHandler(router.handler);

  if (expressApp) {
    server.removeListener('request', expressApp);

    // bind the router to the express app
    expressApp.use(next);

    // use the express app as the next function
    next = expressApp;
  }

  // handle cors headers for all requests by default
  server.prependListener('request', (req: IncomingMessage, res: ServerResponse) => {
    const corsHeaders = {
      ...controller.DEFAULT_CORS_HEADERS,
      ...controller.getCorsHeaders(new Headers(req.headers as any)),
    };

    if (req.method === "OPTIONS") {
      res.writeHead(204, corsHeaders);
      res.end();
      return;
    }

    Object.entries(corsHeaders).forEach(([key, value]) => {
      res.setHeader(key, value);
    });

    next(req, res);
  });
}

/**
 * Do not use this directly. This is used internally by `@colyseus/playground`.
 * TODO: refactor. Avoid using globals.
 * @internal
 */
export let __globalEndpoints: Record<string, Endpoint> = {};

export function createRouter<
  E extends Record<string, Endpoint>,
  Config extends RouterConfig
>(endpoints: E, config: Config = {} as Config) {
  // TODO: refactor. Avoid using globals.
  __globalEndpoints = endpoints;

  return createBetterCallRouter({ ...endpoints }, config);
}
