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
const cst = require('pm2/constants');
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
    // requestId: set by post-deploy.cjs to match this reply; older ones send none
    const [cwd, ecosystemFilePath, requestId] = arg0.split(':');
    console.log("Received 'post-deploy' action!", { cwd, config: ecosystemFilePath });

    let replied = false;

    const onReply = function(result) {
      if (replied) { return; }
      replied = true;
      reply({ ...result, requestId });
    }

    try {
      const config = await shared.getAppConfig(ecosystemFilePath);
      const ticket = ++latestTicket;

      takeTurn('post-deploy', (done) => postDeploy({ ...config.apps[0], cwd }, onReply, done, ticket));

    } catch (err) {
      onReply({ success: false, message: err?.message });
    }
  });
});

const restartingAppIds = new Set();

// Every post-deploy takes a ticket. Only the newest one rolls out: the files on
// disk and the ecosystem config are the latest deploy's anyway.
let latestTicket = 0;

const WAITING_MESSAGE = "Post-deploy success. This server has no room for more processes " +
  "until a draining one exits: this version goes live then, and players keep " +
  "being served meanwhile.";

/**
 * Rollouts take turns. Two at once plan against the same pool: both pick the
 * same old processes to restart and stop, which can orphan one on its socket,
 * and one can route NGINX to processes the other is about to drain.
 *
 * A rollout holds the turn from planning until its old generation has left
 * `online`; the drain itself runs outside it. NGINX updates and reconciles made
 * outside a rollout take a turn too.
 */
const TURN_TIMEOUT = 5 * 60 * 1000;
let turns = Promise.resolve();

function takeTurn(label, task) {
  const turn = turns.then(() => new Promise((release) => {
    // a stuck step must never block every later deploy
    const timer = setTimeout(() => {
      console.warn(`${label} held the rollout turn for ${TURN_TIMEOUT / 1000}s, releasing it.`);
      release();
    }, TURN_TIMEOUT);

    const done = () => { clearTimeout(timer); release(); };

    try {
      task(done);
    } catch (err) {
      logIfError(err);
      done();
    }
  }));

  turns = turn;
  return turn;
}

function postDeploy(config, reply, done, ticket) {
  if (ticket !== latestTicket) {
    console.log(`Deploy #${ticket} superseded by #${latestTicket}`);
    reply({ success: true, message: "Post-deploy success. A newer deploy on this server is rolling out instead." });
    return done();
  }

  console.log(`Deploy #${ticket} rolling out`);

  appConfig = config;

  shared.listApps(function(err, apps) {
    if (err) {
      console.error(err);
      done();
      return reply({ success: false, message: err?.message });
    }

    // first deploy, start all processes
    if (apps.length === 0) {
      return pm2.start(config, (err, result) => {
        reply({ success: !err, message: err?.message });
        done();
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
          done();
          if (!err) { reconcileAndSave(config); }
        });
      });
    }

    /**
     * Graceful restart: bring the new generation up, point NGINX at it, drain
     * the old one, then reconcile the pool and persist.
     */
    let plan = rollout.planRollout({ apps, instances: config.instances });

    // At the peak with nothing to reuse (the previous rollout still draining):
    // start above it if the RAM is free, otherwise wait for a slot.
    const overshoot = rollout.planOvershoot({
      plan,
      instances: config.instances,
      availableMB: shared.availableMemoryMB(),
      ceilingMB: shared.memoryCeilingMB(config),
    });

    if (overshoot > 0) {
      console.log("Previous deploy still draining: starting", overshoot, "process(es) above the usual peak");
      plan = { ...plan, toSpawn: overshoot, scaleTo: apps.length + overshoot };

    } else if (plan.reuse.length === 0 && plan.toSpawn === 0) {
      console.log("No free slot and no memory to spare: waiting for a process to exit");
      reply({ success: true, message: WAITING_MESSAGE });

      const surplus = rollout.planSurplus({ live: plan.appsToStop, instances: config.instances, routed: routedInstances() });

      return drainSurplus(surplus, config).catch(logIfError).then(() => {
        done();
        if (surplus.length > 0) { routeToActive(); }
        waitForCapacity(config, ticket);
      });
    }

    // PM2 scales by cloning an existing process: give them this deploy's
    // start settings first, or the new generation inherits whatever they had
    const configured = Promise.all(apps.map((app) => withCurrentConfig(app.pm2_env.pm_id, config)));

    const bringUp = plan.scaleTo === null
      ? Promise.resolve([])
      : configured.then(() => new Promise((resolve, reject) => {
          console.log("Scaling to", plan.scaleTo, "for", plan.toSpawn, "new process(es)");
          pm2.scale(apps[0].name, plan.scaleTo, (err) => {
            if (err) { return reject(err); }
            // PM2 numbers instances itself; read back what it started
            shared.listApps((err, after) => err ? reject(err) : resolve(rollout.newProcesses(apps, after)));
          });
        }));

    const revive = configured.then(() => Promise.all(plan.reuse.map((app_env) => new Promise((resolve, reject) => {
      restartingAppIds.add(app_env.pm_id);
      pm2.restart(app_env.pm_id, (err) => {
        restartingAppIds.delete(app_env.pm_id);
        if (err) { return reject(err); }

        // reset counter stats (restart_time=0)
        pm2.reset(app_env.pm_id, logIfError);
        shared.updateProcessConfig(app_env.pm_id, config, logIfError);
        resolve(app_env);
      });
    }))));

    Promise.all([bringUp, revive])
      .then(([spawned, revived]) => onFirstAppsStart(spawned.concat(revived)))
      .catch((err) => replyIfError(err, reply))
      .finally(done);

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

      const outgoing = drain.toRestart.concat(drain.toStop);
      await Promise.all(outgoing.map((app_env) => withCurrentConfig(app_env.pm_id, config)));

      const restarts = drain.toRestart.map((app_env) => new Promise((resolve) => {
        restartingAppIds.add(app_env.pm_id);
        pm2.restart(app_env.pm_id, (err) => {
          restartingAppIds.delete(app_env.pm_id);
          if (err) { logIfError(err); return resolve(); }

          // reset counter stats (restart_time=0)
          pm2.reset(app_env.pm_id, logIfError);
          shared.updateProcessConfig(app_env.pm_id, config, logIfError);

          // route to it now, not only once every other process has drained
          routeToActive(() => resolve());
        });
      }));

      // Each stop or restart resolves once PM2 has the process down (or back),
      // which may take up to kill_timeout while rooms drain.
      const stops = drain.toStop.map((app_env) => new Promise((resolve) =>
        pm2.stop(app_env.pm_id, (err) => { logIfError(err); resolve(); })));

      await leftOnline(outgoing);

      if (drain.numActive < config.instances) {
        const target = initialApps.length + drain.numActive;
        console.log("Scale up to", target);
        await new Promise((resolve) => pm2.scale(apps[0].name, target, (err) => { logIfError(err); resolve(); }));
      }

      // the next rollout may plan now: the old generation is draining
      done();

      // housekeeping once the stops are through, and again once the restarts are
      await Promise.all(stops);
      await reconcileAndSave(config);

      if (restarts.length > 0) {
        await Promise.all(restarts);
        await reconcileAndSave(config);
      }
    }
  });
}

/**
 * Drop stopped slots beyond the rolling-deploy peak, refresh NGINX from what is
 * actually running, and `pm2 save`. Runs at the end of every rollout on a
 * fresh list, so this deploy's own leftovers count and the saved state can
 * never resurrect more than the peak.
 *
 * Takes a turn: a rollout planning at the same time may be reusing the very
 * stopped slots this deletes.
 */
function reconcileAndSave(config) {
  return takeTurn('reconcile', (done) => shared.listApps((err, apps) => {
    if (err) { logIfError(err); return done(); }

    const surplus = rollout.planReclaim({ apps, instances: config.instances });
    if (surplus.length > 0) {
      console.log("Reclaiming", surplus.length, "surplus process(es)");
    }

    Promise.all(surplus.map((app_env) =>
      new Promise((resolve) => pm2.delete(app_env.pm_id, (err) => { logIfError(err); resolve(); }))
    )).then(() => updateAndReloadNginx((err) => {
      if (err) { return done(); }
      // "pm2 save"
      pm2.dump((err) => { logIfError(err); done(); });
    }));
  }));
}

/** Drain processes beyond the pool's size, so their slots free up. */
async function drainSurplus(app_envs, config) {
  if (app_envs.length === 0) { return; }

  console.log("Draining", app_envs.length, "surplus process(es) to free a slot");
  await Promise.all(app_envs.map((app_env) => withCurrentConfig(app_env.pm_id, config)));
  app_envs.forEach((app_env) => pm2.stop(app_env.pm_id, logIfError));
  await leftOnline(app_envs);
}

/** Instance numbers NGINX currently routes to. */
function routedInstances() {
  try {
    const ports = fs.readFileSync(shared.NGINX_SERVERS_CONFIG_FILE, 'utf8').match(/\d+(?=\.sock)/g) || [];
    return new Set(ports.map((port) => Number(port) - rollout.socketPort(0)));
  } catch (e) {
    return new Set();
  }
}

/**
 * Roll out once a draining process has exited (or there is RAM to start above
 * the peak). The live generation keeps serving until then. Gives up when a
 * newer deploy arrives -- it takes over -- or once every drain must be over.
 */
function waitForCapacity(config, ticket) {
  const drainMs = Number(config.env?.kill_timeout) || 30 * 60 * 1000;
  const deadline = Date.now() + drainMs + 60 * 1000;

  (function check() {
    if (ticket !== latestTicket) { return; }

    shared.listApps((err, apps) => {
      // the app was removed meanwhile: don't bring it back
      if (!err && apps.length === 0) {
        return console.log("App removed while a deploy waited for a slot; not starting it.");
      }

      if (!err) {
        const plan = rollout.planRollout({ apps, instances: config.instances });
        const hasCapacity = plan.reuse.length > 0 || plan.toSpawn > 0 || rollout.planOvershoot({
          plan,
          instances: config.instances,
          availableMB: shared.availableMemoryMB(),
          ceilingMB: shared.memoryCeilingMB(config),
        }) > 0;

        if (hasCapacity) {
          console.log("A draining process exited: resuming the waiting deploy");
          return takeTurn('post-deploy (resumed)', (done) => postDeploy(config, () => {}, done, ticket));
        }
      }

      if (Date.now() > deadline) {
        return console.error("Gave up waiting for a draining process to exit; the previous version keeps serving.");
      }
      setTimeout(check, 2000);
    });
  })();
}

/** Point NGINX at every running process, between rollouts. */
function routeToActive(cb) {
  return takeTurn('nginx update', (done) => updateAndReloadNginx((err, app_envs) => {
    done();
    cb?.(err, app_envs);
  }));
}

/**
 * Wait until PM2 has taken each outgoing process out of `online`, so the next
 * rollout plans against a pool where they are already draining.
 */
function leftOnline(app_envs, timeout = 5000) {
  const deadline = Date.now() + timeout;

  return new Promise((resolve) => {
    (function check() {
      shared.listApps((err, apps) => {
        const stillOnline = !err && app_envs.some((app_env) => apps.some((app) =>
          app.pm2_env.pm_id === app_env.pm_id &&
          app.pm2_env.status === cst.ONLINE_STATUS &&
          app.pm2_env.pm_uptime === app_env.pm_uptime));

        if (!stillOnline || Date.now() >= deadline) { return resolve(); }
        setTimeout(check, 100);
      });
    })();
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
    if (!err && apps.length === 0) { err = "no apps running."; }
    if (err) {
      console.error(err);
      return cb?.(err);
    }

    const app_envs = shared.filterActiveApps(apps).map((app) => app.pm2_env);

    writeNginxConfig(app_envs);

    // update processes config (memory limit, etc)
    app_envs.forEach((app_env) => 
      shared.updateProcessConfig(app_env.pm_id, appConfig, logIfError));

    cb?.(null, app_envs);
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

  // every write reloads NGINX, and each reload leaves the previous workers
  // holding their WebSockets until they close: only write a real change
  const contents = addresses.sort().map(address => `server ${address};`).join("\n");
  if (fs.readFileSync(shared.NGINX_SERVERS_CONFIG_FILE, 'utf8') === contents) { return; }

  fs.writeFileSync(shared.NGINX_SERVERS_CONFIG_FILE, contents);
}

/**
 * Give an existing process this deploy's start/stop settings, and nothing else.
 *
 * PM2 stops a process with the `kill_timeout` it was started with: one started
 * outside a deploy (the legacy script, e.g. on boot) has PM2's 1.6s default,
 * and would be SIGKILLed mid-drain. PM2 also scales by cloning an existing
 * process, so the new generation starts with that process's `listen_timeout`.
 *
 * The rest (max_memory_restart, ...) waits for the new generation: a draining
 * process given a lower memory limit gets restarted by PM2 mid-drain.
 */
function withCurrentConfig(pm_id, config) {
  return new Promise((resolve) => shared.updateProcessConfig(pm_id, config, (err) => {
    logIfError(err);
    resolve();
  }, shared.LIFECYCLE_KEYS));
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