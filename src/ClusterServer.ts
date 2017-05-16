import * as cluster from "cluster";
import * as memshared from "memshared";
import * as net from "net";
import * as os from "os";

import { Server as WebSocketServer, IServerOptions } from "uws";

import { ServerOptions } from "./Server";

import { setupMaster } from "./cluster/Master";
import { setupWorker } from "./cluster/Worker";

export enum ClusterProtocol {
  BIND_CLIENT,
  CREATE_ROOM,
}

export interface ClusterOptions {
  numWorkers?: number;
}

export class ClusterServer {
  protected server: net.Server;

  constructor (options: ClusterOptions = {}) {
    if (cluster.isMaster) {
      this.server = setupMaster();
    }
  }

  listen (port: number, hostname?: string, backlog?: number, listeningListener?: Function) {
    if (cluster.isMaster) {
      this.server.listen(port, hostname, backlog, listeningListener);
    }
  }

  register (name: string, handler: Function, options?: any) {
    if (cluster.isWorker) {
    }
  }

  attach (options: ServerOptions) {
    if (!cluster.isWorker) {
      console.warn("ClusterServer#attach method should only be called from a worker process.");
      return;
    }

    if (options.server) {
      // Don't expose internal server to the outside.
      this.server = setupWorker(options.server.listen(0, "localhost"));
      (<any>options).server = this.server;
    }

    // if (options.server || options.port) {
    //   this.wss = new WebSocketServer(options);
    //
    // } else {
    //   this.wss = options.ws;
    // }
    //
    // this.wss.on('connection', this.onConnect);
  }

}
