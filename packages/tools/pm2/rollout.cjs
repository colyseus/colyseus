/**
 * Pure decision logic behind the rolling deploy in post-deploy-agent.cjs.
 *
 * Kept free of PM2 calls so the rollout can be reasoned about (and tested)
 * without a live daemon — the agent only executes what these functions decide.
 */
const cst = require('pm2/constants');
const { spawnCount, peakProcesses } = require('./shared.cjs');

const BASE_PORT = 2567;

// RAM left untouched when starting processes above the peak
const OVERSHOOT_MARGIN_MB = 256;

/** Socket port for a worker, matching `listen()` in src/index.ts. */
function socketPort(nodeAppInstance) {
  return BASE_PORT + Number(nodeAppInstance);
}

/**
 * Decide how the next generation of processes comes up.
 *
 * The box may hold at most `peakProcesses(instances)` at once. The new
 * generation is `spawnCount(instances)` wide; it is filled from stopped slots
 * first, and only spawns for what those cannot cover — so the count is driven
 * by `instances`, never by how many processes happen to be running already.
 *
 * @param {object} opts
 * @param {Array}  opts.apps       pm2.list() output, agent module already filtered out
 * @param {number} opts.instances  desired process count (config.instances)
 */
function planRollout({ apps, instances }) {
  const width = spawnCount(instances);
  const peak = peakProcesses(instances);

  const stopped = [];
  const live = [];

  apps.forEach(({ pm2_env: env }) => {
    if (env.status === cst.STOPPED_STATUS) {
      stopped.push(env);
    } else if (env.status !== cst.STOPPING_STATUS) {
      live.push(env);
    }
  });

  const reuse = stopped.slice(0, width);
  const toSpawn = Math.max(0, Math.min(width - reuse.length, peak - apps.length));

  return {
    reuse,
    toSpawn,
    scaleTo: toSpawn > 0 ? apps.length + toSpawn : null,
    appsToStop: live,
  };
}

/**
 * Processes to start above the peak when a rollout can bring up none: the
 * previous rollout's old generation is still draining and holds every slot.
 * Draining the live generation with nothing new up would leave no process to
 * route to, so start them anyway -- as long as the RAM each may grow into
 * (its max_memory_restart) is free right now. Zero means wait instead.
 *
 * @param {object} opts
 * @param {object} opts.plan         planRollout() result
 * @param {number} opts.instances    desired process count (config.instances)
 * @param {number} opts.availableMB  memory the kernel can hand out now
 * @param {number} opts.ceilingMB    per-process max_memory_restart
 */
function planOvershoot({ plan, instances, availableMB, ceilingMB }) {
  if (plan.reuse.length > 0 || plan.toSpawn > 0) { return 0; }
  if (!(ceilingMB > 0) || !(availableMB > 0)) { return 0; }

  const affordable = Math.floor((availableMB - OVERSHOOT_MARGIN_MB) / ceilingMB);
  return Math.max(0, Math.min(spawnCount(instances), affordable));
}

/**
 * Live processes beyond `instances` to drain when a rollout has no slot to start
 * in and no RAM to go above the peak. Nothing else would ever free a slot: they
 * are online, not draining (revived by hand, or by a monitor). Unrouted ones
 * first -- they take no new players anyway -- and the rest keep serving.
 *
 * @param {object} opts
 * @param {Array}  opts.live       planRollout().appsToStop
 * @param {number} opts.instances  desired process count (config.instances)
 * @param {Set<number>} opts.routed instance numbers NGINX currently routes to
 */
function planSurplus({ live, instances, routed }) {
  const extra = live.length - instances;
  if (extra <= 0) { return []; }

  const isRouted = (env) => routed.has(Number(env.NODE_APP_INSTANCE)) ? 1 : 0;
  return live
    .slice()
    .sort((a, b) => (isRouted(a) - isRouted(b)) || (b.pm_id - a.pm_id))
    .slice(0, extra);
}

/**
 * Processes present in `after` but not in `before` — what a `pm2.scale` just
 * brought up. PM2 numbers instances itself (lowest free slot), so the agent
 * re-lists instead of predicting.
 */
function newProcesses(before, after) {
  const known = new Set(before.map((app) => app.pm2_env.pm_id));
  return after
    .filter((app) => !known.has(app.pm2_env.pm_id))
    .map((app) => app.pm2_env);
}

/**
 * Of the outgoing processes, decide which are restarted into the new generation
 * and which are stopped outright.
 */
function planDrain({ appsToStop, activeCount, instances }) {
  const toRestart = [];
  const toStop = [];

  let numActive = activeCount;

  appsToStop.forEach((env) => {
    if (numActive < instances) {
      numActive++;
      toRestart.push(env);
    } else {
      toStop.push(env);
    }
  });

  return { toRestart, toStop, numActive };
}

/**
 * Stopped slots to delete once the box holds more than a rolling deploy needs.
 * Newest first, so surviving instance numbers stay compact. Stopped only — a
 * stopped process serves no traffic, so removing it is free.
 *
 * Run on a fresh list after the drain, so this deploy's own leftovers count.
 */
function planReclaim({ apps, instances }) {
  const overBy = apps.length - peakProcesses(instances);
  if (overBy <= 0) { return []; }

  return apps
    .map((app) => app.pm2_env)
    .filter((env) => env.status === cst.STOPPED_STATUS)
    .sort((a, b) => Number(b.NODE_APP_INSTANCE) - Number(a.NODE_APP_INSTANCE))
    .slice(0, overBy);
}

module.exports = {
  OVERSHOOT_MARGIN_MB,
  socketPort,
  planRollout,
  planOvershoot,
  planSurplus,
  newProcesses,
  planDrain,
  planReclaim,
};
