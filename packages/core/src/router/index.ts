import type express from "express";
import type { IncomingMessage, ServerResponse } from "http";
import { createHash, timingSafeEqual } from "node:crypto";
import { type Endpoint, type Router, type RouterConfig, createRouter as createBetterCallRouter, createEndpoint, createMiddleware, APIError } from "@colyseus/better-call";
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
      if (router.findRoute(req.method, req.url.split('?')[0]) !== undefined) {
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

export function createRouter<
  E extends Record<string, Endpoint>,
  Config extends RouterConfig
>(endpoints: E, config: Config = {} as Config) {
  return createBetterCallRouter({ ...endpoints }, {
    // better-call's /api/reference page dumps the full API surface
    // unauthenticated — opt back in by passing `openapi` explicitly.
    openapi: { disabled: true },
    ...config,
  });
}

export interface BasicAuthOptions {
  /** username → password. The common static case. */
  users?: Record<string, string>;
  /** Custom validator (e.g. DB-backed). Takes precedence over `users`. */
  validate?: (username: string, password: string) => boolean | Promise<boolean>;
  /** Realm shown in the browser prompt. Default 'Restricted'. */
  realm?: string;
}

/**
 * HTTP Basic Auth middleware. Drop into any endpoint's `use:` slot to gate
 * it behind a browser credentials prompt:
 *
 *   playground({ use: [basicAuth({ users: { admin: 's3cret' } })] })
 */
export function basicAuth(opts: BasicAuthOptions) {
  const { users, validate } = opts;
  if (!users && !validate) {
    throw new Error('[basicAuth] provide `users` or `validate`');
  }
  // Realm is interpolated into a header — strip `"` so it can't break out.
  const challenge = `Basic realm="${(opts.realm ?? 'Restricted').replace(/"/g, '')}", charset="UTF-8"`;

  return createMiddleware(async (ctx) => {
    const creds = parseBasicHeader(ctx.getHeader('authorization'));
    const ok = !!creds && (validate
      ? await validate(creds.username, creds.password)
      : staticCheck(users!, creds.username, creds.password));
    if (!ok) {
      throw new APIError(401, { message: 'authentication required' }, { 'WWW-Authenticate': challenge });
    }
  });
}

function parseBasicHeader(header: string | null | undefined) {
  if (!header) { return null; }
  const sep = header.indexOf(' ');
  if (sep < 0 || header.slice(0, sep).toLowerCase() !== 'basic') { return null; }
  let decoded: string;
  try { decoded = Buffer.from(header.slice(sep + 1), 'base64').toString('utf8'); } catch { return null; }
  const colon = decoded.indexOf(':');
  if (colon < 0) { return null; }
  return { username: decoded.slice(0, colon), password: decoded.slice(colon + 1) };
}

function staticCheck(users: Record<string, string>, username: string, password: string): boolean {
  const expected = Object.prototype.hasOwnProperty.call(users, username) ? users[username] : undefined;
  // Compare even for an unknown user so reject timing doesn't reveal which
  // usernames exist.
  return safeEqual(password, expected ?? '\0') && expected !== undefined;
}

// Hash both sides first: equalizes length (timingSafeEqual throws on a
// length mismatch, which would itself leak the secret's length).
function safeEqual(a: string, b: string): boolean {
  return timingSafeEqual(
    createHash('sha256').update(a).digest(),
    createHash('sha256').update(b).digest(),
  );
}

// ---------------------------------------------------------------------------
// dualModeEndpoints — shared express-compat layer for @colyseus/admin,
// @colyseus/monitor, @colyseus/playground. Builds the two local routers
// (specific = no catch-all, full = everything) and the matching node
// handlers, then packages the express middleware so the return value works
// both as `{...spread}` into createRouter AND as `app.use("/", x)` middleware.
// ---------------------------------------------------------------------------

export type ExpressMiddleware = (
  req: IncomingMessage,
  res: ServerResponse,
  next: (err?: any) => void,
) => void;

export type NodeHandler = (req: IncomingMessage, res: ServerResponse) => Promise<void>;

export interface DualModeHelpers {
  specificRouter: Router;
  specificHandler: NodeHandler;
  fullRouter: Router;
  fullHandler: NodeHandler;
}

export function dualModeEndpoints<E extends Record<string, Endpoint>>(
  endpoints: E,
  opts: {
    /** Key in `endpoints` whose path is a catch-all. Excluded from `specificRouter` so it doesn't eat fall-through decisions. */
    catchAllKey?: keyof E;
    /** Build the express middleware given the pre-built routers + node handlers. */
    buildMiddleware: (helpers: DualModeHelpers) => ExpressMiddleware;
  },
): ExpressMiddleware & E {
  const fullRouter = createRouter(endpoints);
  const fullHandler = toNodeHandler(fullRouter.handler) as NodeHandler;

  const specificEndpoints = opts.catchAllKey
    ? Object.fromEntries(
        Object.entries(endpoints).filter(([k]) => k !== opts.catchAllKey),
      ) as Partial<E>
    : endpoints;
  const specificRouter = createRouter(specificEndpoints as E);
  const specificHandler = toNodeHandler(specificRouter.handler) as NodeHandler;

  const middleware = opts.buildMiddleware({
    specificRouter, specificHandler, fullRouter, fullHandler,
  });
  return Object.assign(middleware, endpoints) as ExpressMiddleware & E;
}
