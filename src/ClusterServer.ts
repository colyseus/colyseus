import * as cluster from "cluster";
import * as child_process from "child_process";
import * as memshared from "memshared";
import * as net from "net";
import * as os from "os";

import { Server as WebSocketServer, IServerOptions } from "uws";

import { ServerOptions } from "./Server";

import { spawnWorkers, spawnMatchMaking } from "./cluster/Master";
import { setupWorker } from "./cluster/Worker";
import { Protocol } from "./Protocol";
import { MatchMaker } from "./MatchMaker";

export interface ClusterOptions {
  numWorkers?: number;
}

export class ClusterServer {
  protected server: net.Server;

  // master process attributes
  protected matchMakingWorker: child_process.ChildProcess;

  // child process attributes
  protected matchMaker: MatchMaker;

  constructor (options: ClusterOptions = {}) {
    if (cluster.isMaster) {
       spawnWorkers(options);

       this.matchMakingWorker = spawnMatchMaking();
       memshared.store['matchmaking_process'] = this.matchMakingWorker.pid;

       // clients are only allowed to communicate with match-making by default
       this.server = net.createServer({ pauseOnConnect: true }, (connection) => {
         console.log("connection.address", connection.address);
         console.log("connection.remoteAddress", connection.remoteAddress);
         console.log("connection.localAddress", connection.localAddress);

         // TODO: check endpoint url
         this.matchMakingWorker.send(Protocol.BIND_CLIENT, connection);
       });
    }

    if (cluster.isWorker) {
      this.matchMaker = new MatchMaker();
    }
  }

  listen (port: number, hostname?: string, backlog?: number, listeningListener?: Function) {
    if (cluster.isMaster) {
      this.server.listen(port, hostname, backlog, listeningListener);
    }
  }

  register (name: string, handler: Function, options: any = {}) {
    if (cluster.isMaster) {
      if (!memshared.store['handlers']) {
        memshared.store['handlers'] = [];
      }

      // push to available handlers list
      memshared.store['handlers'].push(name);

    } else {
      // register session handler
      this.matchMaker.addHandler(name, handler, options);
    }
  }

  attach (options: ServerOptions) {
    if (!cluster.isWorker) {
      console.warn("ClusterServer#attach method should only be called from a worker process.");
      return;
    }

    if (options.server) {
      // Don't expose internal server to the outside.
      this.server = setupWorker(options.server.listen(0, "localhost"), this.matchMaker);
      (<any>options).server = this.server;
    }

    this.server.on("connection", () => {
      console.log("Connected!");
    });
  }

}
