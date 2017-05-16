import * as cluster from "cluster";
import * as net from "net";
import { ClusterProtocol } from "../ClusterServer";

export function setupWorker (server: net.Server) {
  process.on('message', (message, connection) => {
    console.log("worker received message:", message);

    if (message !== ClusterProtocol.BIND_CLIENT) {
      return;
    }

    // Emulate a connection event on the server by emitting the
    // event with the connection the master sent us.
    server.emit('connection', connection);

    connection.resume();
  });

  return server;
}

