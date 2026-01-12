import type { Server } from "http";
import { type Endpoint, type Router, type RouterConfig, createRouter as createBetterCallRouter, createEndpoint } from "@colyseus/better-call";
import { toNodeHandler } from "@colyseus/better-call/node";

export {
  createEndpoint,
  createMiddleware,
  createInternalContext,

  // Re-export types needed for declaration emit
  type Router,
  type RouterConfig,
  type Endpoint,
  type EndpointOptions,
  type EndpointContext,
  type StrictEndpoint,
} from "@colyseus/better-call";

export { toNodeHandler };

export function bindRouterToServer(server: Server, router: Router) {
  // check if the server is bound to an express app
  const expressApp: any = server.listeners('request').find((listener: Function) =>
    listener.name === "app" && listener['mountpath'] === '/');

  if (expressApp) {
    // bind the router to the express app
    expressApp.use(toNodeHandler(router.handler));

  } else {
    // otherwise, bind the router to the http server
    server.on('request', toNodeHandler(router.handler));
  }
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
>(endpoints: E, config?: Config) {
  // TODO: refactor. Avoid using globals.
  __globalEndpoints = endpoints;

  return createBetterCallRouter({ ...endpoints, }, config);
}
