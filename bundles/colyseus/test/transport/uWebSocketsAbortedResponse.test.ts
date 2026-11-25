import assert from "node:assert";
import { spawn, type ChildProcess } from "node:child_process";
import net from "node:net";
import { fileURLToPath } from "node:url";

const FIXTURE_PATH = fileURLToPath(
  new URL("../fixtures/uws-aborted-response-server.mjs", import.meta.url),
);

interface ChildIpcMessage {
  type: string;
  port?: number;
  finished?: boolean;
  writableEnded?: boolean;
}

function waitForMessage(
  child: ChildProcess,
  expectedType: string,
  timeoutMs: number,
  getStderr: () => string,
): Promise<ChildIpcMessage> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error(`Timed out waiting for IPC "${expectedType}" after ${timeoutMs}ms\n${getStderr()}`));
    }, timeoutMs);

    const onMessage = (msg: unknown) => {
      if (msg && typeof msg === "object" && (msg as ChildIpcMessage).type === expectedType) {
        cleanup();
        resolve(msg as ChildIpcMessage);
      }
    };

    const onError = (err: Error) => {
      cleanup();
      reject(new Error(`Child process error while waiting for "${expectedType}": ${err.message}\n${getStderr()}`));
    };

    const onExit = (code: number | null, signal: NodeJS.Signals | null) => {
      cleanup();
      reject(
        new Error(
          `Child exited (code=${code}, signal=${signal}) before "${expectedType}"\n${getStderr()}`,
        ),
      );
    };

    function cleanup() {
      clearTimeout(timer);
      child.off("message", onMessage);
      child.off("error", onError);
      child.off("exit", onExit);
    }

    child.on("message", onMessage);
    child.once("error", onError);
    child.once("exit", onExit);
  });
}

function closeSocket(socket: net.Socket, timeoutMs = 2000): Promise<void> {
  if (socket.destroyed) {
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      socket.destroy();
      resolve();
    }, timeoutMs);
    socket.once("close", () => {
      clearTimeout(timer);
      resolve();
    });
    socket.destroy();
  });
}

async function stopChild(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) {
    return;
  }

  await new Promise<void>((resolve) => {
    const killTimer = setTimeout(() => {
      if (child.exitCode === null && child.signalCode === null) {
        child.kill("SIGKILL");
      }
    }, 2000);

    child.once("close", () => {
      clearTimeout(killTimer);
      resolve();
    });

    child.kill("SIGTERM");
  });
}

describe("Transport: uWebSockets.js: aborted Express response", () => {
  it("keeps the process alive when the client disconnects before the response", async () => {
    const child = spawn(process.execPath, [FIXTURE_PATH], {
      env: { ...process.env },
      stdio: ["ignore", "pipe", "pipe", "ipc"],
    });

    let stderr = "";
    child.stderr?.on("data", (chunk: Buffer | string) => {
      stderr += chunk.toString();
    });

    let socket: net.Socket | undefined;

    try {
      const ready = await waitForMessage(child, "ready", 10000, () => stderr);
      const port = ready.port;
      assert.strictEqual(typeof port, "number");
      assert.ok(port !== undefined && port > 0, `expected valid port, got ${port}`);

      const slowEnteredPromise = waitForMessage(child, "slow-entered", 5000, () => stderr);

      socket = await new Promise<net.Socket>((resolve, reject) => {
        const conn = net.createConnection({ host: "127.0.0.1", port }, () => {
          conn.write("GET /slow HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n");
          resolve(conn);
        });
        conn.once("error", reject);
      });

      await slowEnteredPromise;
      await closeSocket(socket);

      const slowHandledPromise = waitForMessage(child, "slow-handled", 5000, () => stderr);
      child.send({ type: "client-aborted" });

      const handled = await slowHandledPromise;
      assert.strictEqual(handled.finished, true);
      assert.strictEqual(handled.writableEnded, true);
      assert.strictEqual(
        child.exitCode,
        null,
        `server exited after abort with code ${child.exitCode}\n${stderr}`,
      );

      const health = await fetch(`http://127.0.0.1:${port}/health`, {
        signal: AbortSignal.timeout(5000),
      });
      assert.strictEqual(health.status, 200);
      assert.deepStrictEqual({ status: "ok" }, await health.json());
    } finally {
      if (socket) {
        await closeSocket(socket);
      }
      await stopChild(child);
    }
  });
});
