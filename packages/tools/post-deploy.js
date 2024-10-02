#!/usr/bin/env node
const pm2 = require('pm2');
const os = require('os');
const fs = require('fs');
const path = require('path');

const opts = { env: process.env.NODE_ENV || "production" };
const maxCPU = os.cpus().length;

// // allow deploying from other path as root.
// if (process.env.npm_config_local_prefix) {
//   process.chdir(process.env.npm_config_local_prefix);
//   pm2.cwd = process.env.npm_config_local_prefix;
// }

const CONFIG_FILE = [
  'ecosystem.config.cjs',
  'ecosystem.config.js',
  'pm2.config.cjs',
  'pm2.config.js',
].find((filename) => fs.existsSync(path.resolve(pm2.cwd, filename)));

if (!CONFIG_FILE) {
  throw new Error('missing ecosystem config file. make sure to provide one with a valid "script" entrypoint file path.');
}

pm2.list(function(err, apps) {
  bailOnErr(err);

  // TODO: flush previous logs (?)
  // pm2.flush();

  if (apps.length === 0) {
    //
    // first deploy
    //
    pm2.start(CONFIG_FILE, { ...opts }, () => onAppRunning());

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

function onAppRunning(reloadedAppIds) {
  // reset reloaded app stats
  if (reloadedAppIds) {
    resetAppStats(reloadedAppIds);
  }
  updateColyseusBootService();
  updateAndReloadNginx();
}

function restartAll () {
  pm2.delete('all', function (err) {
    // kill & start again
    pm2.kill(function () {
      pm2.start(CONFIG_FILE, { ...opts }, () => onAppRunning());
    });
  });
}

function reloadAll(retry = 0) {
  pm2.reload(CONFIG_FILE, { ...opts }, function (err, apps) {
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
    if (apps.length !== maxCPU) {
      pm2.scale(name, maxCPU, () => onAppRunning(reloadedAppIds));

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

function updateColyseusBootService() {
  //
  // Update colyseus-boot.service to use the correct paths for the application
  //
  const COLYSEUS_CLOUD_BOOT_SERVICE = '/etc/systemd/system/colyseus-boot.service';

  // ignore if no boot service found
  if (!fs.existsSync(COLYSEUS_CLOUD_BOOT_SERVICE)) {
    return;
  }

  const workingDirectory = pm2.cwd;
  const execStart = `${detectPackageManager()} colyseus-post-deploy`;

  const contents = fs.readFileSync(COLYSEUS_CLOUD_BOOT_SERVICE, 'utf8');
  try {
    fs.writeFileSync(COLYSEUS_CLOUD_BOOT_SERVICE, contents
      .replace(/WorkingDirectory=(.*)/, `WorkingDirectory=${workingDirectory}`)
      .replace(/ExecStart=(.*)/, `ExecStart=${execStart}`));
  } catch (e) {
    // couldn't write to file
  }
}

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

  const NGINX_SERVERS_CONFIG_FILE = '/etc/nginx/colyseus_servers.conf';

  pm2.list(function(err, apps) {
    if (apps.length === 0) {
      err = "no apps running.";
    }
    bailOnErr(err);

    const port = 2567;
    const addresses = [];

    apps.forEach(function(app) {
      addresses.push(`unix:/run/colyseus/${ port + app.pm2_env.NODE_APP_INSTANCE }.sock`);
    });

    // write NGINX config
    fs.writeFileSync(NGINX_SERVERS_CONFIG_FILE, addresses.map(address => `server ${address};`).join("\n"), bailOnErr);

    // "pm2 save"
    pm2.dump(function (err, ret) {
      bailOnErr(err);

      // exit with success!
      process.exit();
    });

  });
}

function detectPackageManager() {
  const lockfiles = {
    // npm
    "npm exec": path.resolve(pm2.cwd, 'package-lock.json'),

    // yarn
    "yarn exec": path.resolve(pm2.cwd, 'yarn.lock'),

    // pnpm
    "pnpm exec": path.resolve(pm2.cwd, 'pnpm-lock.yaml'),

    // bun
    "bunx": path.resolve(pm2.cwd, 'bun.lockb'),
  };

  for (const [key, value] of Object.entries(lockfiles)) {
    if (fs.existsSync(value)) {
      return key;
    }
  }

  return "npm";
}

function bailOnErr(err) {
  if (err) {
    console.error(err);

    // exit with error!
    process.exit(1);
  }
}

