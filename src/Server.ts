import * as cluster from "cluster";
import * as http from "http";

import { IServerOptions } from "uws";
import { ClusterServer } from "./ClusterServer";

export class Server {
  protected clusterServer: ClusterServer;

  constructor (options?: IServerOptions) {
    this.clusterServer = new ClusterServer();

    if (options.server) {
      this.attach({ server: options.server as http.Server });
    }
  }

  attach (options: { server: http.Server }) {
    this.clusterServer.attach(options);
  }

  listen (port: number, hostname?: string, backlog?: number, listeningListener?: Function) {
    this.clusterServer.listen(port, hostname, backlog, listeningListener);
  }

  register (name: string, handler: Function, options: any = {}) {
    this.clusterServer.register(name, handler, options);
  }
}
