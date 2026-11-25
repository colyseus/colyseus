/**
 * Spawned by uWebSocketsAbortedResponse.test.ts: verifies that aborting an
 * unfinished Express response does not throw on read-only `writableEnded`
 * and keeps the server process alive.
 */
import { createRequire } from "node:module";
import { defineServer } from "@colyseus/core";
import { uWebSocketsTransport } from "@colyseus/uwebsockets-transport";

const uwsRequire = createRequire(import.meta.resolve("@colyseus/uwebsockets-transport"));
const uWebSockets = uwsRequire("uWebSockets.js");

function waitForClientAborted(timeoutMs) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      process.off("message", onMessage);
      reject(new Error(`Timed out waiting for client-aborted IPC after ${timeoutMs}ms`));
    }, timeoutMs);

    function onMessage(msg) {
      if (msg && msg.type === "client-aborted") {
        clearTimeout(timer);
        process.off("message", onMessage);
        resolve();
      }
    }

    process.on("message", onMessage);
  });
}

async function waitForFinishedFlag(res, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (!res.finished) {
    if (Date.now() >= deadline) {
      return false;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  return true;
}

const transport = new uWebSocketsTransport();

const server = defineServer({
  greet: false,
  rooms: {},
  transport,
  express: (app) => {
    app.get("/slow", async (_req, res) => {
      process.send?.({ type: "slow-entered" });

      try {
        await waitForClientAborted(5000);
      } catch (err) {
        console.error(err);
        process.exit(2);
      }

      const abortedObserved = await waitForFinishedFlag(res, 2000);
      if (!abortedObserved) {
        console.error("res.finished did not become true after client-aborted");
        process.exit(2);
      }

      res.json({ ok: true });

      setImmediate(() => {
        process.send?.({
          type: "slow-handled",
          finished: res.finished,
          writableEnded: res.writableEnded,
        });
      });
    });

    app.get("/health", (_req, res) => res.json({ status: "ok" }));
  },
});

await server.listen(0);

const listeningSocket = transport._listeningSocket;
if (!listeningSocket) {
  throw new Error("uWS failed to bind listening socket");
}

const port = uWebSockets.us_socket_local_port(listeningSocket);
if (!Number.isInteger(port) || port <= 0) {
  throw new Error(`Invalid uWS bound port: ${port}`);
}

process.send?.({ type: "ready", port });
