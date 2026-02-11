import type express from "express";
import type { IncomingMessage, ServerResponse } from "http";
import { type Endpoint, type Router, type RouterConfig, createRouter as createBetterCallRouter, createEndpoint } from "@colyseus/better-call";
import { toNodeHandler, getRequest, setResponse } from "@colyseus/better-call/node";
import { Transport } from "../Transport.ts";
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

export function bindRouterToTransport(transport: Transport, router: Router, useExpress: boolean) {
  // add default "/__healthcheck" endpoint
  router.addEndpoint(createEndpoint("/__healthcheck", { method: "GET" }, async (ctx) => {
    return new Response("OK", { status: 200 });
  }));

  const server = transport.server;

  // check if the server is bound to an express app
  const expressApp: express.Application = (useExpress)
    ? transport.getExpressApp() as express.Application
    // fallback searching for express app in server listeners
    : server?.listeners('request').find((listener: Function) => listener.name === "app" && listener['mountpath'] === '/') as express.Application;

  // add default "/" route, if not provided.
  const hasRootRoute = (
    // check if express app has a root route
    (expressApp && expressRootRoute(expressApp) !== undefined) ||

    // check if router has a root route
    Object.values(router.endpoints).some(endpoint => endpoint.path === "/")
  );

  if (!hasRootRoute) {
    router.addEndpoint(createEndpoint("/", { method: "GET" }, async (ctx) => {
      return new Response(`Colyseus ${pkg.version}`, { status: 200 });
    }));
  }

  // use custom bindRouter method if provided
  if (!server && transport.bindRouter) {
    transport.bindRouter(router);
    return;
  }

  // which route handler to use
  // (router + fallback to express, or just router)
  let next: any;

  if (expressApp) {
    server.removeListener('request', expressApp);

    next = async (req: IncomingMessage, res: ServerResponse) => {
      // check if the route is defined in the router
      // if so, use the router handler, otherwise fallback to express
      if (router.findRoute(req.method, req.url) !== undefined) {
        const protocol = req.headers["x-forwarded-proto"] || ((req.socket as any).encrypted ? "https" : "http");
        const base = `${protocol}://${req.headers[":authority"] || req.headers.host}`;
        const response = await router.handler(getRequest({ base, request: req }));
        return setResponse(res, response);

      } else {
        return expressApp['handle'](req, res);
      }
    };

  } else {
    next = toNodeHandler(router.handler);
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

function expressRootRoute(expressApp: express.Application) {
  //
  // express v5 uses `app.router`, express v4 uses `app._router`
  // check for `app._router` first, then `app.router`
  //
  // (express v4 will show a warning if `app.router` is used)
  //
  const stack = (expressApp as any)?._router?.stack ?? (expressApp as any)?.router?.stack;

  if (!stack) {
    return false;
  }

  return stack.find((layer: any) => layer.match('/') && !['query', 'expressInit'].includes(layer.name));
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
