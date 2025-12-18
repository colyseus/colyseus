const os = require('os');

/**
 * COLYSEUS CLOUD WARNING:
 * ----------------------
 * PLEASE DO NOT UPDATE THIS FILE MANUALLY AS IT MAY CAUSE DEPLOYMENT ISSUES
 */

module.exports = {
  apps : [{
    name: "colyseus-app",
    script: 'src/app.config.ts',
    interpreter: 'node',
    time: true,
    watch: false,
    // instances: 2,
    instances: 1,
    exec_mode: 'fork',
    wait_ready: true,
    kill_timeout: 30 * 60 * 1000,
    kill_retry_time: 5000,
    env_production: {
      NODE_ENV: 'production'
    }
  }],
};
