import type { Server } from "http";
import { type Router, createRouter } from "@colyseus/better-call";
import { toNodeHandler } from "@colyseus/better-call/node";

export {
  createEndpoint,
  createMiddleware,
  createInternalContext,
} from "@colyseus/better-call";

export { type Router, toNodeHandler, createRouter };

export function bindRouterToServer(server: Server, router: Router) {
  // check if the server is bound to an express app
  const expressApp: any = server.listeners('request').find((listener: Function) =>
    listener.name === "app" && listener['mountpath'] === '/');

  if (expressApp) {
    // bind the router to the express app
    expressApp.use(toNodeHandler(router.handler));

  } else {
    // bind the router to the server
    server.on('request', toNodeHandler(router.handler));
  }
}
