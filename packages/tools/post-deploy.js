#!/usr/bin/env node
const pm2 = require('pm2');
const os = require('os');
const fs = require('fs');

const opts = { env: process.env.NODE_ENV || "production" };
const maxCPU = os.cpus().length;

const NGINX_CONFIG_FILE = '/etc/nginx/colyseus_servers.conf';

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

    const port = 2567;
    const addresses = [];

    apps.forEach(function(app) {
      addresses.push(`127.0.0.1:${ port + app.pm2_env.NODE_APP_INSTANCE }`);
    });

    fs.writeFileSync(NGINX_CONFIG_FILE, addresses.map(address => `server ${address};`).join("\n"));

    // "pm2 save"
    pm2.dump(function(err, ret) {
      bailOnErr(err);

      // exit with success!
      process.exit();
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
