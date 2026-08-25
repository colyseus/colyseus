import { createEndpoint } from "@colyseus/better-call";
import { createRouter } from "./index.ts";
import * as matchMaker from "../MatchMaker.ts";
import { createAuthContext, getTransport } from "../Transport.ts";

export const postMatchmakeMethod = createEndpoint("/matchmake/:method/:roomName", { method: "POST" }, async (ctx) => {
  // do not accept matchmaking requests if already shutting down
  if (matchMaker.state === matchMaker.MatchMakerState.SHUTTING_DOWN) {
    throw ctx.error(503);
  }

  const requestHeaders = ctx.request.headers;

  const method = ctx.params.method;
  const roomName = ctx.params.roomName;

  try {
    const clientOptions = ctx.body;
    const response = await matchMaker.controller.invokeMethod(
      method,
      roomName,
      clientOptions,
      createAuthContext({ headers: requestHeaders, req: ctx.request }),
    );

    //
    // TODO: refactor here.
    // expose protocol, if available.
    //
    const transport = getTransport();
    if (transport.protocol !== undefined) {
      response.protocol = transport.protocol;
    }
    // WebTransport (h3): client pins the self-signed cert via serverCertificateHashes.
    if (transport.fingerprint !== undefined) {
      response.fingerprint = transport.fingerprint;
    }

    const json = JSON.stringify(response);

    return new Response(json, {
      headers: {
        'content-type': 'application/json',
        //
        // Set content length manually to avoid "chunked" transfer-encoding header
        // See https://github.com/haxetink/tink_http/issues/27
        //
        'content-length': json.length.toString(),
      },
    }) as any;

  } catch (e: any) {
    throw ctx.error(e.code, { code: e.code, error: e.message, });
  }

});

export function getDefaultRouter() {
  // no public docs page — the docs surface is playground's gated /__apidocs
  return createRouter({ postMatchmakeMethod }, { openapi: { disabled: true } });
}