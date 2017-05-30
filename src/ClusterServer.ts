import * as cluster from "cluster";
import * as child_process from "child_process";
import * as memshared from "memshared";
import * as net from "net";
import * as http from "http";
import * as os from "os";

import { ServerOptions } from "./Server";

import { spawnWorkers, spawnMatchMaking, getNextWorkerForSocket } from "./cluster/Master";
import { setupWorker } from "./cluster/Worker";
import { Protocol } from "./Protocol";
import { MatchMaker } from "./MatchMaker";
import { generateId } from "./";

let cache = memshared.store;

export interface ClusterOptions {
  numWorkers?: number;
}

export class ClusterServer {
  protected server: net.Server | http.Server;

  // master process attributes
  protected matchMakingWorker: child_process.ChildProcess;

  // child process attributes
  protected matchMaker: MatchMaker;

  constructor (options: ClusterOptions = {}) {
    if (cluster.isMaster) {
       spawnWorkers(options);

       this.matchMakingWorker = spawnMatchMaking();
       cache['matchmaking_process'] = this.matchMakingWorker.pid;

       this.server = http.createServer();
       this.server.on('connection', (socket) => {
         // pauseOnConnect
         socket.pause();
       });

       this.server.on('request', (request, response) => {
         console.log("TODO: forward regular http requests to next worker.");
         let socket = request.connection;
         let worker = getNextWorkerForSocket(socket);
         worker.send([Protocol.PASS_HTTP_SOCKET], socket)
       });

       this.server.on('upgrade', (request, socket, head) => {
         let worker = this.matchMakingWorker;
         let roomId = request.url.substr(1);

         // bind client to the worker that has requested room spawed
         if (cache[roomId]) {
           worker = memshared.getProcessById(cache[roomId]);
         }

         worker.send([Protocol.PASS_WEBSOCKET, {
           headers: request.headers,
           method: request.method,
         }, head], socket);
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
      if (!cache['handlers']) {
        cache['handlers'] = [];
      }

      // push to available handlers list
      cache['handlers'].push(name);

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
    }
  }

}
