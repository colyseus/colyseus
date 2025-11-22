import type { Server } from "http";
import { type Endpoint, type Router, type RouterConfig, createRouter as createBetterCallRouter, createEndpoint, generator } from "@colyseus/better-call";
import { toNodeHandler } from "@colyseus/better-call/node";

export {
  createEndpoint,
  createMiddleware,
  createInternalContext,
} from "@colyseus/better-call";

export { type Router, toNodeHandler };

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

export function createRouter<
  E extends Record<string, Endpoint>,
  Config extends RouterConfig
>(endpoints: E, config?: Config) {
  /**
   * TODO: this route should be protected in production
   */
  const openApiRoute = createEndpoint("/__openapi", {
    method: "GET",
    // metadata: { SERVER_ONLY: true }
  }, async (ctx) => {

    /**
     * Optional: if zod is available, we can use toJSONSchema() for body and query types
     */
    let z: any = undefined;
    try { z = await import("zod"); } catch (e: any) { /* zod not installed  */ }

    return Object.values(endpoints).map((endpoint) => {
      return {
        method: endpoint.options.method,
        path: endpoint.path,
        body: z && endpoint.options.body && z.toJSONSchema(endpoint.options.body),
        query: z && endpoint.options.query && z.toJSONSchema(endpoint.options.query),
        metadata: endpoint.options.metadata,
        description: endpoint.options.metadata?.openapi?.description,
      };
    });
  });


  return createBetterCallRouter({ ...endpoints, openApiRoute }, config);
}
