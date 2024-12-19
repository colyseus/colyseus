const pm2 = require('pm2');
const os = require('os');

const NAMESPACE = 'cloud';
const MAX_ACTIVE_PROCESSES = os.cpus().length;

function listApps(callback) {
  pm2.list((err, apps) => {
    if (err) { return callback(err);; }

    // Filter out @colyseus/tools module (PM2 post-deploy agent)
    apps = apps.filter(app => app.name !== '@colyseus/tools');

    callback(err, apps);
  });
}

async function getAppConfig(ecosystemFilePath) {
  const module = await import(ecosystemFilePath);
  const config = module.default;

  /**
   * Tune PM2 app config
   */
  if (config.apps && config.apps.length >= 0) {
    const app = config.apps[0];

    // app.name = "colyseus-app";
    app.namespace = NAMESPACE;
    app.exec_mode = "fork";

    app.instances = MAX_ACTIVE_PROCESSES;

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
  }

  return config;
}

module.exports = {
  /**
   * Constants
   */
  NGINX_SERVERS_CONFIG_FILE: '/etc/nginx/colyseus_servers.conf',
  PROCESS_UNIX_SOCK_PATH: '/run/colyseus/',

  MAX_ACTIVE_PROCESSES,
  NAMESPACE,

  /**
   * Shared methods
   */
  listApps,
  getAppConfig,
}