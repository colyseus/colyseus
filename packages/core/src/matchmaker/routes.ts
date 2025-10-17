import { createEndpoint, createRouter } from "better-call";
import * as matchMaker from "../MatchMaker.ts";
import { getBearerToken } from "../utils/Utils.ts";

export const postMatchmakeMethod = createEndpoint("/matchmake/:method/:roomName", { method: "POST" }, async (ctx) => {
  // do not accept matchmaking requests if already shutting down
  if (matchMaker.state === matchMaker.MatchMakerState.SHUTTING_DOWN) {
    throw ctx.error(503);
  }

  const requestHeaders = ctx.request.headers;
  const headers = Object.assign(
    {},
    matchMaker.controller.DEFAULT_CORS_HEADERS,
    matchMaker.controller.getCorsHeaders(requestHeaders)
  );

  const method = ctx.params.method;
  const roomName = ctx.params.roomName;

  Object.entries(headers).forEach(([key, value]) => {
    ctx.setHeader(key, value);
  })
  ctx.setHeader('Content-Type', 'application/json');

  try {
    const clientOptions = ctx.body;
    const response = await matchMaker.controller.invokeMethod(
      method,
      roomName,
      clientOptions,
      {
        token: getBearerToken(ctx.request.headers.get('authorization')),
        headers: ctx.request.headers,
        ip: requestHeaders.get('x-forwarded-for') ?? requestHeaders.get('x-client-ip') ?? requestHeaders.get('x-real-ip'),
        req: ctx.request as any,
      },
    );

    //
    // TODO: respond with protocol, if available
    //
    // // specify protocol, if available.
    // if (this.transport.protocol !== undefined) {
    //   response.protocol = this.transport.protocol;
    // }

    return response;

  } catch (e: any) {
    throw ctx.error(e.code, { code: e.code, error: e.message, });
  }

});

export function getDefaultRouter() {
  return createRouter({ postMatchmakeMethod });
}