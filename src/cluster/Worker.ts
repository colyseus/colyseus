import * as cluster from "cluster";
import * as net from "net";

export function setupWorker (server: net.Server) {
  process.on('message', (message, connection) => {
    if (message !== "redirect") { return; }

    // Emulate a connection event on the server by emitting the
    // event with the connection the master sent us.
    server.emit('connection', connection);

    connection.resume();
  });

  return server;
}

export function spawnWorker () {
  let worker = cluster.fork();

  worker.on("message", (message) => {
    console.log("Worker received message:", message);
  });

  // auto-spawn a new worker on failure
  worker.on("exit", () => {
    console.warn("worker", process.pid, "died. Respawn.")
    spawnWorker();
  });

  return worker;
}
