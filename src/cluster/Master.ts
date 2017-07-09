import * as cluster from "cluster";
import * as memshared from "memshared";
import * as child_process from "child_process";
import * as net from "net";
import * as os from "os";
import * as ip from "ip";

import { ClusterOptions } from "../ClusterServer";
import { Protocol } from "../Protocol";
import { spliceOne } from "../Utils";

const seed = (Math.random() * 0xffffffff) | 0;
let workers = [];

export function getNextWorkerForSocket (socket: net.Socket) {
  let hash = getHash(ip.toBuffer(socket.remoteAddress || '127.0.0.1'));
  return workers[hash % workers.length];
}


export function spawnWorkers (options: ClusterOptions = {}) {
  // use the number of CPUs as number of workers.
  if (!options.numWorkers) {
    options.numWorkers = os.cpus().length;
  }

  for (var i = 0, len = options.numWorkers; i < len; i++) {
    spawnWorker();
  }
}

export function spawnMatchMaking () {
  let worker = child_process.fork(__dirname + "/../matchmaking/Process", [], { silent: false });

  enableProcessCommunication(worker);

  // allow worker to use memshared
  memshared.registerProcess(worker);

  return worker;
}

export function spawnWorker () {
  let worker = cluster.fork();

  if (!memshared.store['workerIds']) {
    memshared.store['workerIds'] = [];
  }

  // push worker id to shared workers list.
  memshared.store['workerIds'].push(worker.process.pid);

  // push worker to workers list
  workers.push(worker);

  enableProcessCommunication(worker);

  // auto-spawn a new worker on failure
  worker.on("exit", () => {
    console.warn("worker", process.pid, "died. Respawn.")

    // remove workerId from shared store
    spliceOne(memshared.store['workerIds'], memshared.store['workerIds'].indexOf(process.pid));

    // remove worker from workers list.
    spliceOne(workers, workers.indexOf(worker));

    // spawn new worker as a replacement for this one
    spawnWorker();
  });

  return worker;
}

function enableProcessCommunication(worker: child_process.ChildProcess | cluster.Worker) {
  worker.on("message", (message) => {
    let workerProcess = Array.isArray(message) && memshared.getProcessById(message.shift());
    if (workerProcess) {
      workerProcess.send(message);
    }
  });

}

/**
 */
function getHash (ip: Buffer) {
  let hash = seed;
  for (var i = 0; i < ip.length; i++) {
    var num = ip[i];

    hash += num;
    hash %= 2147483648;
    hash += (hash << 10);
    hash %= 2147483648;
    hash ^= hash >> 6;
  }

  hash += hash << 3;
  hash %= 2147483648;
  hash ^= hash >> 11;
  hash += hash << 15;
  hash %= 2147483648;

  return hash >>> 0;
}
