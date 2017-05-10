import * as cluster from "cluster";
import * as child_process from "child_process";
import * as net from "net";
import * as os from "os";

import { ClusterOptions } from "../ClusterServer";
import { spawnWorker } from "./Worker";

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
    matchMakingWorker.send("redirect", connection);
  });
}

function spawnMatchMaking () {
  let worker = child_process.fork(__dirname + "/../matchmaking", [], { silent: false });

  // Listen to messages the worker sends to master
  worker.on('message', (message) => {
    console.log("Match maker send message:", message);
  });

  return worker;
}
