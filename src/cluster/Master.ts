import * as cluster from "cluster";
import * as memshared from "memshared";
import * as child_process from "child_process";
import * as net from "net";
import * as os from "os";

import { ClusterOptions, ClusterProtocol } from "../ClusterServer";

export function setupMaster (options: ClusterOptions = {}) {
  let matchMakingWorker = spawnMatchMaking();

  // use the number of CPUs as number of workers.
  if (!options.numWorkers) {
    options.numWorkers = os.cpus().length;
  }

  for (var i = 0, len = options.numWorkers; i < len; i++) {
    spawnWorker();
  }

  // clients are only allowed to communicate with match-making by default
  return net.createServer({ pauseOnConnect: true }, (connection) => {
    matchMakingWorker.send(ClusterProtocol.BIND_CLIENT, connection);
  });
}

function spawnMatchMaking () {
  let worker = child_process.fork(__dirname + "/../matchmaking", [], { silent: false });

  worker.on("message", (message) => {
    let workerProcess = Array.isArray(message) && memshared.getProcessById(message.shift());
    console.log(message);
    if (workerProcess) {
      console.log(`match-making wants to communicate with pid(${ workerProcess.pid }) `);
      workerProcess.send(message);
    }
  });

  // allow worker to use memshared
  memshared.registerProcess(worker);

  return worker;
}

export function spawnWorker () {
  let worker = cluster.fork();

  // push worker to shared 'workerIds' list.
  if (!memshared.store['workerIds']) {
    memshared.store['workerIds'] = [];
  }

  memshared.store['workerIds'].push(worker.process.pid);

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
