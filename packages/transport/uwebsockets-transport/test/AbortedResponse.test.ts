import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type express from "express";

import { defineServer } from "@colyseus/core";
import { Client } from "@colyseus/sdk";
import { uWebSocketsTransport } from "../src/index.ts";

const TEST_PORT = 8592;

/**
 * A client that disconnects before an Express route responds must not take the
 * process down when the route responds anyway. (#1005, #924)
 */
describe("response after client abort", () => {
  let server: ReturnType<typeof defineServer>;
  let onSlowRequest: (res: express.Response) => void;

  const client = new Client(`http://127.0.0.1:${TEST_PORT}`);

  beforeAll(async () => {
    server = defineServer({
      greet: false,
      transport: new uWebSocketsTransport(),
      rooms: {},
      express: (app) => {
        app.get("/slow", (_req, res) => onSlowRequest(res));
        app.get("/health", (_req, res) => res.json({ status: "ok" }));
      },
    });

    await server.listen(TEST_PORT);
  });

  afterAll(async () => {
    await server.gracefullyShutdown(false);
  });

  /** Resolves with the response of the next `/slow` request, left unanswered. */
  function nextSlowRequest() {
    return new Promise<express.Response>((resolve) => onSlowRequest = resolve);
  }

  /** Requests `/slow`, disconnects, and resolves once the server noticed. */
  async function abortedRequest() {
    const reached = nextSlowRequest();
    const controller = new AbortController();
    const request = client.http.get("/slow", { signal: controller.signal });

    const res = await reached;
    controller.abort();
    await expect(request).rejects.toThrow();

    await expect.poll(() => res.writableEnded).toBe(true);
    return res;
  }

  const writeHeadAndEnd = (res: express.Response) => {
    res.writeHead(200, { "Content-Type": "text/plain" });
    res.end("ok");
  };

  const RESPONSES: { [name: string]: (res: express.Response) => void } = {
    "res.json()": (res) => res.json({ ok: true }),
    "res.status().send()": (res) => res.status(500).send("failed"),
    "res.writeHead() + res.end()": writeHeadAndEnd,
    "res.write() + res.end()": (res) => {
      res.write("partial");
      res.end("ok");
    },
    "res.redirect()": (res) => res.redirect("/health"),
  };

  for (const [name, respond] of Object.entries(RESPONSES)) {
    it(`${name} should be a no-op`, async () => {
      respond(await abortedRequest());

      // server remains operational
      const health = await client.http.get("/health");
      expect(health.data).toEqual({ status: "ok" });
    });
  }

  it("should still respond to a client that stays connected", async () => {
    const reached = nextSlowRequest();
    const request = client.http.get("/slow");

    writeHeadAndEnd(await reached);

    expect((await request).data).toBe("ok");
  });
});
