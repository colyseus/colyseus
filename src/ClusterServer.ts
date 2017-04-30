import * as cluster from "cluster";
import * as net from "net";
import * as os from "os";

import { Server, ServerOptions } from "./Server";

export interface ClusterOptions { numWorkers?: number; }

enum ClusterMessage { REDIRECT };

export class ClusterServer extends Server {
  protected options: ClusterOptions;
  protected server: net.Server;

  protected matchMakingWorker: cluster.Worker;

  constructor (options: ClusterOptions = {}) {
    super();

    this.options = options;

    // use the number of CPUs as number of workers.
    if (!this.options.numWorkers) {
      this.options.numWorkers = os.cpus().length;
    }

    if (cluster.isMaster) {
      this.setupMaster();
    }

    if (cluster.isWorker) {
      this.setupWorker();
    }
  }

  setupMaster () {
    for (var i = 0, len = this.options.numWorkers; i < len; i++) {
      this.spawnWorker();
    }

    this.matchMakingWorker = this.spawnMatchMaking();

    this.server = net.createServer({ pauseOnConnect: true }, (connection) => {
      //
      // by default, new clients are only allowed to communicate with match-making
      //
      this.matchMakingWorker.send(ClusterMessage.REDIRECT, connection);
    });

  }

  listen (port: number, hostname?: string, backlog?: number, listeningListener?: Function) {
    if (cluster.isMaster) {
      this.server.listen(port, hostname, backlog, listeningListener);
    }
  }

  attach (options: ServerOptions) {
    if (cluster.isWorker && options.server) {
      // Don't expose internal server to the outside.
      this.server = options.server.listen(0, "localhost");;
      (<any>options).server = this.server;
    }

    super.attach(options);
  }

  protected spawnMatchMaking () {
    let worker = this.spawnWorker ();

    return worker;
  }

  protected spawnWorker () {
    let worker = cluster.fork();

    // auto-spawn a new worker on failure
    worker.on("exit", () => {
      console.warn("worker", process.pid, "died. Respawn.")
      this.spawnWorker();
    });

    return worker;
  }

  protected setupWorker () {
    process.on('message', (message, connection) => {
      if (!ClusterMessage[ message ]) { return; }

      // Emulate a connection event on the server by emitting the
      // event with the connection the master sent us.
      this.server.emit('connection', connection);

      connection.resume();
    });
  }

}
