/**
 * PM2 Agent for no downtime deployments on Colyseus Cloud.
 *
 * How it works:
 * - New process(es) are spawned (MAX_ACTIVE_PROCESSES/2)
 * - NGINX configuration is updated so new traffic only goes through the new process
 * - Old processes are asynchronously and gracefully stopped.
 * - The rest of the processes are spawned/reactivated.
 */
const pm2 = require('pm2');
const fs = require('fs');
const io = require('@pm2/io');
const path = require('path');
const shared = require('./shared.cjs');
const rollout = require('./rollout.cjs');

let appConfig = undefined;

// This agent is itself a PM2 fork, so PM2 gives it NODE_APP_INSTANCE=0 — and
// PM2 merges the caller's process.env into every app it starts. Left in place,
// that "0" overrides the number PM2 assigns each worker, so they all claim the
// same instance (and the same socket). Drop it before the first pm2.* call.
delete process.env.NODE_APP_INSTANCE;

io.initModule({
  pid: path.resolve('/var/run/colyseus-agent.pid'),
  widget: {
    type: 'generic',
    logo: 'https://colyseus.io/images/logos/logo-dark-color.png',
    theme : ['#9F1414', '#591313', 'white', 'white'],
  }
});

pm2.connect(function(err) {
  if (err) {
    console.error(err.stack || err);
    process.exit();
  }
  console.log('PM2 post-deploy agent is up and running...');

  /**
   * Remote actions
   */
  io.action('post-deploy', async function (arg0, reply) {
    const [cwd, ecosystemFilePath] = arg0.split(':');
    console.log("Received 'post-deploy' action!", { cwd, config: ecosystemFilePath });

    let replied = false;

    //
    // Override 'reply' to decrement amount of concurrent deployments
    //
    const onReply = function() {
      if (replied) { return; }
      replied = true;
      reply.apply(null, arguments);
    }

    try {
      const config = await shared.getAppConfig(ecosystemFilePath);

      appConfig = { ...config.apps[0], cwd };

      postDeploy(appConfig, onReply);

    } catch (err) {
      onReply({ success: false, message: err?.message });
    }
  });
});

const restartingAppIds = new Set();

function postDeploy(config, reply) {
  shared.listApps(function(err, apps) {
    if (err) {
      console.error(err);
      return reply({ success: false, message: err?.message });
    }

    // first deploy, start all processes
    if (apps.length === 0) {
      return pm2.start(config, (err, result) => {
        reply({ success: !err, message: err?.message });
        if (!err) { reconcileAndSave(config); }
      });
    }

    //
    // detect if cwd has changed, and restart PM2 if it has
    //
    if (apps[0].pm2_env.pm_cwd !== config.cwd) {
      console.log("App Root Directory changed. Restarting may take a bit longer...");

      //
      // remove all and start again with new cwd
      //
      return pm2.delete('all', function (err) {
        logIfError(err);

        // start again
        pm2.start(config, (err, result) => {
          reply({ success: !err, message: err?.message });
          if (!err) { reconcileAndSave(config); }
        });
      });
    }

    /**
     * Graceful restart: bring the new generation up, point NGINX at it, drain
     * the old one, then reconcile the pool and persist.
     */
    const plan = rollout.planRollout({ apps, instances: config.instances });

    const bringUp = plan.scaleTo === null
      ? Promise.resolve([])
      : new Promise((resolve, reject) => {
          console.log("Scaling to", plan.scaleTo, "for", plan.toSpawn, "new process(es)");
          pm2.scale(apps[0].name, plan.scaleTo, (err) => {
            if (err) { return reject(err); }
            // PM2 numbers instances itself; read back what it started
            shared.listApps((err, after) => err ? reject(err) : resolve(rollout.newProcesses(apps, after)));
          });
        });

    const revive = Promise.all(plan.reuse.map((app_env) => new Promise((resolve, reject) => {
      restartingAppIds.add(app_env.pm_id);
      pm2.restart(app_env.pm_id, (err) => {
        restartingAppIds.delete(app_env.pm_id);
        if (err) { return reject(err); }

        // reset counter stats (restart_time=0)
        pm2.reset(app_env.pm_id, logIfError);
        shared.updateProcessConfig(app_env.pm_id, config, logIfError);
        resolve(app_env);
      });
    })));

    Promise.all([bringUp, revive])
      .then(([spawned, revived]) => onFirstAppsStart(spawned.concat(revived)))
      .catch((err) => replyIfError(err, reply));

    async function onFirstAppsStart(initialApps) {
      /**
       * release post-deploy action while proceeding with graceful restart of other processes
       */
      reply({ success: true });

      initialApps.forEach((app_env) =>
        shared.updateProcessConfig(app_env.pm_id, config, logIfError));

      /**
       * - Write NGINX config to expose only the new active process
       * - The old ones processes will go down asynchronously (or will be restarted)
       */
      writeNginxConfig(initialApps);

      //
      // Wait 1.5 seconds to ensure NGINX is updated & reloaded
      //
      await new Promise(resolve => setTimeout(resolve, 1500));

      //
      // Asynchronously stop/restart apps with active connections
      // (They make take from minutes up to hours to stop)
      //
      const drain = rollout.planDrain({
        appsToStop: plan.appsToStop,
        activeCount: initialApps.length + restartingAppIds.size,
        instances: config.instances,
      });

      drain.toRestart.forEach((app_env) => {
        restartingAppIds.add(app_env.pm_id);
        pm2.restart(app_env.pm_id, (err) => {
          restartingAppIds.delete(app_env.pm_id);
          if (err) { return logIfError(err); }

          // reset counter stats (restart_time=0)
          pm2.reset(app_env.pm_id, logIfError);
          shared.updateProcessConfig(app_env.pm_id, config, logIfError);
        });
      });

      // Each stop resolves once PM2 has the process down, which may take up to
      // kill_timeout while rooms drain. Reconcile waits for them so it sees
      // the settled pool, not one still mid-transition.
      const stops = drain.toStop.map((app_env) =>
        new Promise((resolve) => pm2.stop(app_env.pm_id, (err) => { logIfError(err); resolve(); })));

      if (drain.numActive < config.instances) {
        const target = initialApps.length + drain.numActive;
        console.log("Scale up to", target);
        await new Promise((resolve) => pm2.scale(apps[0].name, target, (err) => { logIfError(err); resolve(); }));
      }

      await Promise.all(stops);
      reconcileAndSave(config);
    }
  });
}

/**
 * Drop stopped slots beyond the rolling-deploy peak, refresh NGINX from what is
 * actually running, and `pm2 save`. Runs at the end of every rollout on a
 * fresh list, so this deploy's own leftovers count and the saved state can
 * never resurrect more than the peak.
 */
function reconcileAndSave(config) {
  shared.listApps((err, apps) => {
    if (err) { return logIfError(err); }

    const surplus = rollout.planReclaim({ apps, instances: config.instances });
    if (surplus.length > 0) {
      console.log("Reclaiming", surplus.length, "surplus process(es)");
    }

    Promise.all(surplus.map((app_env) =>
      new Promise((resolve) => pm2.delete(app_env.pm_id, (err) => { logIfError(err); resolve(); }))
    )).then(() => updateAndReloadNginx(() => complete()));
  });
}

function updateAndReloadNginx(cb) {
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
    if (apps.length === 0) { err = "no apps running."; }
    if (err) { return console.error(err); }

    const app_envs = shared.filterActiveApps(apps).map((app) => app.pm2_env);

    writeNginxConfig(app_envs);

    // update processes config (memory limit, etc)
    app_envs.forEach((app_env) => 
      shared.updateProcessConfig(app_env.pm_id, appConfig, logIfError));

    cb?.(app_envs);
  });
}

function writeNginxConfig(app_envs) {
  if (!fs.existsSync(shared.NGINX_SERVERS_CONFIG_FILE)) {
    console.warn(`NGINX config file not found at ${shared.NGINX_SERVERS_CONFIG_FILE}, skipping NGINX config update.`);
    return;
  }

  // An empty upstream block is an NGINX config error, so the reload would take
  // the site down. A list can come up empty for an instant when every process
  // is mid-transition; keep the last good one rather than publish nothing.
  if (app_envs.length === 0) {
    console.warn("No active process to route to; leaving NGINX config untouched.");
    return;
  }

  const addresses = [];

  app_envs.forEach(function(app_env) {
    addresses.push(`unix:${shared.PROCESS_UNIX_SOCK_PATH}${rollout.socketPort(app_env.NODE_APP_INSTANCE)}.sock`);
  });

  // write NGINX config
  fs.writeFileSync(shared.NGINX_SERVERS_CONFIG_FILE, addresses.map(address => `server ${address};`).join("\n"), logIfError);
}

function complete() {
  // "pm2 save"
  pm2.dump(logIfError);
}

function logIfError (err) {
  if (err) {
    console.error(err);
  }
}

function replyIfError(err, reply) {
  if (err) {
    console.error(err);
    reply({ success: false, message: err?.message });
  }
}