#!/usr/bin/env node

const os = require('os');
const fs = require('fs');
const { exec } = require('child_process');

const NGINX_LIMITS_CONFIG_FILE = '/etc/nginx/colyseus_limits.conf';
const LIMITS_CONF_FILE = "/etc/security/limits.conf";

// update file descriptor limits systemwide + nginx worker connections

function bailOnErr(err) {
  if (err) {
    console.error(err);

    // exit with error!
    process.exit(1);
  }
}

function updateNOFileConfig(cb) {
  // const numCPU = os.cpus().length;
  const totalmemMB = os.totalmem() / 1024 / 1024;
  const estimatedCCUPerGB = 5000;

  const maxCCU = Math.floor((totalmemMB / 1024) * estimatedCCUPerGB);
  const workerConnections = maxCCU * 2; // 2x because of proxy_pass
  const nginxMaxNOFileLimit = workerConnections * 2; // 2x
  const systemMaxNOFileLimit = workerConnections * 3; // 3x for other system operations

  // immediatelly apply new nofile limit
  // (apparently this has no effect)
  exec(`ulimit -n ${systemMaxNOFileLimit}`, bailOnErr);

  // update "/etc/security/limits.conf" file.
  fs.writeFileSync(LIMITS_CONF_FILE, `
* - nofile ${systemMaxNOFileLimit}
`, bailOnErr);

  if (fs.existsSync(NGINX_LIMITS_CONFIG_FILE)) {
    fs.writeFileSync(NGINX_LIMITS_CONFIG_FILE, `
worker_rlimit_nofile ${nginxMaxNOFileLimit};

events {
    worker_connections ${workerConnections};
    # multi_accept on;
}
`, cb);
    console.log("new nofile limit:", { workerConnections, systemMaxNOFileLimit, nginxMaxNOFileLimit });

  } else {
    console.warn(NGINX_LIMITS_CONFIG_FILE, "not found.");
  }
}


updateNOFileConfig(bailOnErr);
