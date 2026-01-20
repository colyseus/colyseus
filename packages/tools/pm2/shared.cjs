const pm2 = require('pm2');
const cst = require('pm2/constants');
const os = require('os');

const NAMESPACE = 'cloud';
const MAX_ACTIVE_PROCESSES = Number(process.env.MAX_ACTIVE_PROCESSES || os.cpus().length);

const CONFIG_KEYS = [
  'max_memory_restart',
  'kill_timeout',
  'kill_retry_time',
  'wait_ready',
  'merge_logs',
  'cron_restart',
  'autorestart',
  'exp_backoff_restart_delay',
  'restart_delay',
];

function listApps(callback) {
  pm2.list((err, apps) => {
    if (err) { return callback(err); }

    // Filter out @colyseus/tools module (PM2 post-deploy agent)
    apps = apps.filter(app => app.name !== '@colyseus/tools');

    callback(err, apps);
  });
}

async function getAppConfig(ecosystemFilePath) {
  // Clear require cache to force reload of the config file
  const resolvedPath = require.resolve(ecosystemFilePath);
  delete require.cache[resolvedPath];
  const config = require(ecosystemFilePath);

  /**
   * Tune PM2 app config
   */
  if (config.apps && config.apps.length >= 0) {
    const app = config.apps[0];

    // app.name = "colyseus-app";
    app.namespace = NAMESPACE;
    app.exec_mode = "fork";

    // default: number of CPU cores
    if (app.instances === undefined) {
      app.instances = MAX_ACTIVE_PROCESSES;
    }

    // default: restart if memory exceeds 512M
    if (app.max_memory_restart === undefined) {
      app.max_memory_restart = '512M';
    }

    app.time = true;
    app.wait_ready = true;
    app.watch = false;

    // default: merge logs into a single file
    if (app.merge_logs === undefined) {
      app.merge_logs = true;
    }

    // default: wait for 30 minutes before forcibly killing
    // (prevent forcibly killing while rooms are still active)
    if (!app.kill_timeout) {
      app.kill_timeout = 30 * 60 * 1000;
    }

    // default: retry kill after 1 second
    if (!app.kill_retry_time) {
      app.kill_retry_time = 5000;
    }

    // Ensure these config values are also set in app.env so they take priority
    // over inherited environment variables during PM2's Utility.extend() merge.
    // This prevents the parent process's environment (e.g., @colyseus/tools agent)
    // from overwriting the app's config values like max_memory_restart.
    if (!app.env) {
      app.env = {};
    }

    CONFIG_KEYS.forEach((key) => {
      if (app[key] !== undefined) {
        app.env[key] = convertValue(app[key]);
      }
    });
  }

  return config;
}

function convertValue(value) {
  if (typeof value === 'string') {
    const conversionUnit = {
      // bytes
      'G': 1024 * 1024 * 1024,
      'M': 1024 * 1024,
      'K': 1024,
      // milliseconds
      'h': 60 * 60 * 1000,
      'm': 60 * 1000,
      's': 1000
    };

    if (!conversionUnit[value.slice(-1)]) {
      return parseInt(value, 10);

    } else {
      return parseFloat(value.slice(0, -1)) * (conversionUnit[value.slice(-1)]);
    }
  }
  return value;
}

/**
 * Update process configuration without restart.
 * This patches pm2_env directly via a custom God method.
 * @param {number|string} pm_id - Process ID to update
 * @param {Object} config - Configuration object (e.g., { max_memory_restart: '512M', kill_timeout: 30000 })
 * @param {Function} cb - Callback(err, updatedEnv)
 */
function updateProcessConfig(pm_id, config, cb) {
  const env = {};

  CONFIG_KEYS.forEach((key) => {
    if (config[key] !== undefined) {
      env[key] = convertValue(config[key]);
    }
  });

  const opts = { id: pm_id, env, };
  pm2.Client.executeRemote('updateProcessConfig', opts, cb);
}

module.exports = {
  /**
   * Constants
   */
  NGINX_SERVERS_CONFIG_FILE: process.env.NGINX_CONFIG_FILE || '/etc/nginx/colyseus_servers.conf',
  PROCESS_UNIX_SOCK_PATH: process.env.UNIX_SOCK_PATH || '/run/colyseus/',

  MAX_ACTIVE_PROCESSES,
  NAMESPACE,

  /**
   * Shared methods
   */
  listApps,
  getAppConfig,

  updateProcessConfig,

  filterActiveApps: (apps) => apps.filter(app =>
    app.pm2_env.status !== cst.STOPPING_STATUS &&
    app.pm2_env.status !== cst.STOPPED_STATUS
  ),
}