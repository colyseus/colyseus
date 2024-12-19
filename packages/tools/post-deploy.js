#!/usr/bin/env node
const pm2 = require('pm2');
const fs = require('fs');
const path = require('path');
const shared = require('./pm2/shared');

const opts = { env: process.env.NODE_ENV || "production", };

const CONFIG_FILE = [
  'ecosystem.config.cjs',
  'ecosystem.config.js',
  'pm2.config.cjs',
  'pm2.config.js',
].find((filename) => fs.existsSync(path.resolve(pm2.cwd, filename)));

/**
 * TODO: if not provided, auto-detect entry-point & dynamically generate ecosystem config
 */
if (!CONFIG_FILE) {
  throw new Error('missing ecosystem config file. make sure to provide one with a valid "script" entrypoint file path.');
}

const CONFIG_FILE_PATH = `${pm2.cwd}/${CONFIG_FILE}`;

/**
 * Try to handle post-deploy via PM2 module first (pm2 install @colyseus/tools)
 * If not available, fallback to legacy post-deploy script.
 */
pm2.trigger('@colyseus/tools', 'post-deploy', `${pm2.cwd}:${CONFIG_FILE_PATH}`, async function (err, result) {
  if (err) {
    console.log("Proceeding with legacy post-deploy script...");
    postDeploy();

  } else {
    if (result[0].data?.return?.success === false) {
      console.error(result[0].data?.return?.message);
      process.exit(1);
    } else {
      console.log("Post-deploy success.");
      process.exit();
    }
  }
});

async function postDeploy() {
  shared.listApps(function (err, apps) {
    bailOnErr(err);

    if (apps.length === 0) {
      //
      // first deploy
      //
      pm2.start(CONFIG_FILE_PATH, { ...opts }, () => onAppRunning());

    } else {

      //
      // detect if cwd has changed, and restart PM2 if it has
      //
      if (apps[0].pm2_env.pm_cwd !== pm2.cwd) {
        //
        // remove all and start again with new cwd
        //
        restartAll();

      } else {
        //
        // reload existing apps
        //
        reloadAll();
      }
    }
  });
}

function onAppRunning(reloadedAppIds) {
  // reset reloaded app stats
  if (reloadedAppIds) {
    resetAppStats(reloadedAppIds);
  }
  updateAndReloadNginx();
}

function restartAll () {
  pm2.delete('all', function (err) {
    // kill & start again
    pm2.kill(function () {
      pm2.start(CONFIG_FILE_PATH, { ...opts }, () => onAppRunning());
    });
  });
}

function reloadAll(retry = 0) {
  pm2.reload(CONFIG_FILE_PATH, { ...opts }, function (err, apps) {
    if (err) {
      //
      // Retry in case of "Reload in progress" error.
      //
      if (err.message === 'Reload in progress' && retry < 5) {
        console.warn(err.message, ", retrying...");
        setTimeout(() => reloadAll(retry + 1), 1000);

      } else {
        bailOnErr(err);
      }

      return;
    }

    const name = apps[0].name;
    const reloadedAppIds = apps.map(app => app.pm_id);

    // scale app to use all CPUs available
    if (apps.length !== shared.MAX_ACTIVE_PROCESSES) {
      pm2.scale(name, shared.MAX_ACTIVE_PROCESSES, () => onAppRunning(reloadedAppIds));

    } else {
      onAppRunning(reloadedAppIds);
    }
  });
}

function resetAppStats (reloadedAppIds) {
  reloadedAppIds.forEach((pm_id) => {
    pm2.reset(pm_id, (err, _) => {
      if (err) {
        console.error(err);
      } else {
        console.log(`metrics re-set for app_id: ${pm_id}`);
      }
    });
  });
};

function updateAndReloadNginx() {
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

  shared.listApps(function(err, apps) {
    if (apps.length === 0) {
      err = "no apps running.";
    }
    bailOnErr(err);

    const port = 2567;
    const addresses = [];

    apps.forEach(function(app) {
      addresses.push(`unix:${shared.PROCESS_UNIX_SOCK_PATH}${port + app.pm2_env.NODE_APP_INSTANCE}.sock`);
    });

    // write NGINX config
    fs.writeFileSync(shared.NGINX_SERVERS_CONFIG_FILE, addresses.map(address => `server ${address};`).join("\n"), bailOnErr);

    // "pm2 save"
    pm2.dump(function (err, ret) {
      bailOnErr(err);

      // exit with success!
      process.exit();
    });

  });
}

function bailOnErr(err) {
  if (err) {
    console.error(err);

    // exit with error!
    process.exit(1);
  }
}
