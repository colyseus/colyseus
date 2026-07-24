import assert from "assert";
import net from "net";
import express from "express";

import { defineServer } from "@colyseus/core";
import { uWebSocketsTransport } from "@colyseus/uwebsockets-transport";

const TEST_PORT = 8579;

/**
 * An incomplete HTTP request body must stay request-scoped (408 Request
 * Timeout) instead of crashing the process. (colyseus/uWebSockets-express#43)
 */
describe("Transport: uWebSockets.js: request body read timeout", () => {
  let server: ReturnType<typeof defineServer>;

  async function bootServer(readBodyMaxTime: number) {
    server = defineServer({
      greet: false,
      transport: new uWebSocketsTransport({ readBodyMaxTime }),
      rooms: {},
      express: (app) => {
        app.use(express.json());
        app.post("/echo", (req, res) => res.json(req.body));
        app.get("/health", (_req, res) => res.json({ status: "ok" }));
      },
    });

    await server.listen(TEST_PORT);
  }

  afterEach(async () => {
    await server.gracefullyShutdown(false);
  });

  function postHeaders(contentLength: number) {
    return [
      "POST /echo HTTP/1.1",
      `Host: 127.0.0.1:${TEST_PORT}`,
      "Content-Type: application/json",
      `Content-Length: ${contentLength}`,
      "",
      "",
    ].join("\r\n");
  }

  /**
   * Sends a raw (possibly malformed) HTTP request and resolves with everything
   * the server wrote back, shortly after the response stops arriving.
   */
  function rawRequest(writeChunks: (socket: net.Socket) => void, guardTime: number) {
    return new Promise<string>((resolve, reject) => {
      let response = "";
      let settle: NodeJS.Timeout;
      const socket = net.createConnection({ host: "127.0.0.1", port: TEST_PORT }, () => writeChunks(socket));
      socket.on("data", (chunk) => {
        response += chunk.toString();
        clearTimeout(settle);
        settle = setTimeout(() => socket.destroy(), 50);
      });
      socket.on("close", () => resolve(response));
      socket.on("error", reject);
      setTimeout(() => socket.destroy(), guardTime); // in case no response ever arrives
    });
  }

  it("incomplete body should get 408 and not crash the process", async () => {
    await bootServer(150);

    const response = await rawRequest(
      (socket) => socket.write(postHeaders(100) + '{"partial":'),
      600,
    );

    assert.ok(response.includes("408 Request Timeout"), `expected 408 response, got: "${response}"`);

    // server remains operational
    const health = await fetch(`http://127.0.0.1:${TEST_PORT}/health`);
    assert.deepStrictEqual({ status: "ok" }, await health.json());

    const echo = await fetch(`http://127.0.0.1:${TEST_PORT}/echo`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ hello: "world" }),
    });
    assert.deepStrictEqual({ hello: "world" }, await echo.json());
  });

  it("readBodyMaxTime should allow clients slower than the 500ms default", async () => {
    await bootServer(1000);

    // second half of the body arrives after the 500ms default would have expired
    const body = JSON.stringify({ hello: "world" });
    const half = Math.ceil(body.length / 2);

    const response = await rawRequest((socket) => {
      socket.write(postHeaders(body.length) + body.slice(0, half));
      setTimeout(() => socket.write(body.slice(half)), 650);
    }, 2000);

    assert.ok(response.includes("200"), `expected 200 response, got: "${response}"`);
    assert.ok(response.includes('"hello":"world"'), `expected echoed body, got: "${response}"`);
  });
});
