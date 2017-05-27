import * as cluster from "cluster";
import * as memshared from "memshared";
import * as child_process from "child_process";
import * as net from "net";
import * as os from "os";

import { ClusterOptions } from "../ClusterServer";
import { Protocol } from "../Protocol";
import { spliceOne } from "../Utils";

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

  enableProcessCommunication(worker);

  // auto-spawn a new worker on failure
  worker.on("exit", () => {
    console.warn("worker", process.pid, "died. Respawn.")

    // remove workerId from shared store
    spliceOne(memshared.store['workerIds'], memshared.store['workerIds'].indexOf(process.pid));

    // spawn new worker as a replacement for this one
    spawnWorker();
  });

  return worker;
}

function enableProcessCommunication(worker: child_process.ChildProcess | cluster.Worker) {
  worker.on("message", (message) => {
    let workerProcess = Array.isArray(message) && memshared.getProcessById(message.shift());
    if (workerProcess) {
      console.log(`process wants to communicate directly with pid (${ workerProcess.pid }) `);
      workerProcess.send(message);
    }
  });

}
