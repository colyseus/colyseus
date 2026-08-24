/**
 * Pure decision logic behind the rolling deploy in post-deploy-agent.cjs.
 *
 * Kept free of PM2 calls so the rollout can be reasoned about (and tested)
 * without a live daemon — the agent only executes what these functions decide.
 */
const cst = require('pm2/constants');
const { spawnCount, peakProcesses } = require('./shared.cjs');

const BASE_PORT = 2567;

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
  socketPort,
  planRollout,
  newProcesses,
  planDrain,
  planReclaim,
};
