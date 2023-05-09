#!/usr/bin/env node
const pm2 = require('pm2');
const os = require('os');
const fs = require('fs');
const { exec } = require('child_process');

const opts = { env: process.env.NODE_ENV || "production" };
const maxCPU = os.cpus().length;

const NGINX_SERVERS_CONFIG_FILE = '/etc/nginx/colyseus_servers.conf';
const NGINX_LIMITS_CONFIG_FILE = '/etc/nginx/colyseus_limits.conf';

pm2.list(function(err, apps) {
  bailOnErr(err);

  if (apps.length === 0) {
    // first deploy
    pm2.start('ecosystem.config.js', {...opts}, updateAndReloadNginx);

  } else {
    // reload existing apps
    pm2.reload('ecosystem.config.js', {...opts}, function(err, apps) {
      bailOnErr(err);

      const name = apps[0].name;

      // scale app to use all CPUs available
      if (apps.length !== maxCPU) {
        pm2.scale(name, maxCPU, updateAndReloadNginx);

      } else {
        updateAndReloadNginx();
      }
    });
  }
});

function updateAndReloadNginx() {

  pm2.list(function(err, apps) {
    bailOnErr(err);

    // update file descriptor limits systemwide + nginx worker connections
    updateNOFileConfig(function(err) {
      bailOnErr(err);

      const port = 2567;
      const addresses = [];

      apps.forEach(function(app) {
        addresses.push(`127.0.0.1:${ port + app.pm2_env.NODE_APP_INSTANCE }`);
      });

      fs.writeFileSync(NGINX_SERVERS_CONFIG_FILE, addresses.map(address => `server ${address};`).join("\n"), bailOnErr);

      // "pm2 save"
      pm2.dump(function(err, ret) {
        bailOnErr(err);

        // exit with success!
        process.exit();
      });
    });
  });

  //
  // If you are self-hosting and reading this file, consider using the
  // following in your self-hosted environment:
  //
  // #!/bin/bash
  // # Requires fswatch (`apt install fswatch`)
  // # Reload NGINX when colyseus_servers.conf changes
  // fswatch /etc/nginx/colyseus_servers.conf -m poll_monitor --event=Updated | while read event
  // do
  //     service nginx reload
  // done
}

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
  const estimatedCCUPerGB = 4000;

  const maxCCU = (totalmemMB / 1024) * estimatedCCUPerGB;
  const systemMaxNOFileLimit = maxCCU * 4;
  const nginxMaxNOFileLimit = maxCCU * 3; // 3x because of nginx -> proxy_pass -> node:port

  // immediatelly apply new nofile limit
  exec(`ulimit -n ${systemMaxNOFileLimit}`, bailOnErr);

  // update "/etc/security/limits.conf" file.
  fs.writeFileSync("/etc/security/limits.conf", `
* - nofile $NOFILE_LIMIT
`, bailOnErr);

  if (fs.existsSync(NGINX_LIMITS_CONFIG_FILE)) {
    fs.writeFileSync(NGINX_LIMITS_CONFIG_FILE, `
worker_rlimit_nofile ${nginxMaxNOFileLimit};

events {
    worker_connections ${maxCCU};
    # multi_accept on;
}
`, cb);
    console.log("new nofile limit:", { maxCCU, systemMaxNOFileLimit, nginxMaxNOFileLimit });

  } else {
    console.warn(NGINX_LIMITS_CONFIG_FILE, "not found.");
  }
}

