import * as cluster from "cluster";
import * as child_process from "child_process";
import * as memshared from "memshared";
import * as net from "net";
import * as http from "http";
import * as os from "os";
import * as parseURL from "url-parse";

import { spawnWorkers, spawnMatchMaking, getNextWorkerForSocket, onWorkersShutdown } from "./cluster/Master";
import { setupWorker } from "./cluster/Worker";
import { registerGracefulShutdown } from "./Utils";
import { Protocol } from "./Protocol";
import { MatchMaker, RegisteredHandler } from "./MatchMaker";
import { generateId } from "./";
import { debugCluster } from "./Debug";

let cache = memshared.store;

export interface ClusterOptions {
  server?: http.Server;
}

export class ClusterServer {
  protected server: net.Server | http.Server;

  // master process attributes
  protected matchMakingWorker: child_process.ChildProcess;

  // child process attributes
  protected matchMaker: MatchMaker;

  protected _onShutdown: () => void | Promise<any> = () => Promise.resolve();

  constructor (options: ClusterOptions = {}) {
    if (cluster.isMaster) {
       debugCluster(`master spawned with pid ${ process.pid }`);

       this.matchMakingWorker = spawnMatchMaking();
       cache['matchmaking_process'] = this.matchMakingWorker.pid;
       debugCluster(`matchmaking spawned with pid ${ this.matchMakingWorker.pid }`);

       registerGracefulShutdown((signal) => {
         this.server.removeAllListeners();
         this.matchMakingWorker.removeAllListeners();
         this.matchMakingWorker.kill(signal)

         onWorkersShutdown.
           then(() => this._onShutdown()).
           catch((e) => console.error("ERROR:", e)).
           then(() => process.exit());
      });

       this.server = options.server || http.createServer();
       this.server.on('connection', (socket) => {
         socket.pause();
       });

       this.server.on('request', (request, response) => {
         let socket = request.connection;
         let worker = getNextWorkerForSocket(socket);
         let body = [];

         request.on('data', (chunk) => {
           body.push(chunk);

         }).on('end', () => {
           worker.send([Protocol.PASS_HTTP_SOCKET, {
             url: request.url,
             headers: request.headers,
             body: Buffer.concat(body).toString(),
             method: request.method,
           }], socket);
         });
       });

       this.server.on('upgrade', (request, socket, head) => {
         let worker = this.matchMakingWorker;
         let roomId = parseURL(request.url).pathname.substr(1);

         // bind client to the worker that has the requested room spawed
         if (cache[roomId]) {
           worker = memshared.getProcessById(cache[roomId]);
         }

         // send socket connection from master to a child process
         worker.send([Protocol.PASS_WEBSOCKET, {
           headers: request.headers,
           method: request.method,
         }, head, request.url], socket);
       });
    }

    if (cluster.isWorker) {
      this.matchMaker = new MatchMaker();

      registerGracefulShutdown((signal) => {
        this.matchMaker.gracefullyShutdown().
          then(() => this._onShutdown()).
          catch((err) => console.log("ERROR!", err)).
          then(() => process.kill(process.pid, signal));
      });
    }
  }

  fork (numWorkers: number = os.cpus().length) {
    return spawnWorkers(numWorkers);
  }

  listen (port: number, hostname?: string, backlog?: number, listeningListener?: Function) {
    if (cluster.isMaster) {
      this.server.listen(port, hostname, backlog, listeningListener);
    }
  }

  register (name: string, handler: Function, options: any = {}): RegisteredHandler {
    if (!cluster.isWorker) {
      console.warn("ClusterServer#register should be called from a worker process.");
      return;
    }

    return this.matchMaker.registerHandler(name, handler, options);
  }

  attach (options: { server: http.Server }) {
    if (!cluster.isWorker) {
      console.warn("ClusterServer#attach should be called from a worker process.");
      return;
    }

    if (options.server) {
      // Don't expose internal server to the outside.
      let server = options.server.listen(0, 'localhost');
      server.on('listening', () => {
          this.server = setupWorker(server, this.matchMaker);
      });
    }
  }

  onShutdown (callback: () => void | Promise<any>) {
    this._onShutdown = callback;
  }

}