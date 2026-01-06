/**
 * Monkey-patch for PM2's ActionMethods.js
 * Adds custom methods like updateProcessConfig without modifying the original file.
 */
'use strict';

const Utility = require('../Utility');

// Import the original ActionMethods module
const originalActionMethods = require('./ActionMethods_orig.js');

module.exports = function(God) {
  // Apply original ActionMethods
  originalActionMethods(God);

  /**
   * Update process configuration without restart.
   * Merges opts.env.current_conf into proc.pm2_env.
   * @method updateProcessConfig
   * @param {Object} opts - { id: pm_id, env: { current_conf: { ... } } }
   * @param {Function} cb
   */
  God.updateProcessConfig = function updateProcessConfig(opts, cb) {
    var id = opts.id;

    if (typeof(id) === 'undefined')
      return cb(God.logAndGenerateError('opts.id not passed to updateProcessConfig', opts));
    if (!(id in God.clusters_db))
      return cb(God.logAndGenerateError('Process id unknown'), {});

    const proc = God.clusters_db[id];

    if (!proc || !proc.pm2_env)
      return cb(God.logAndGenerateError('Process not found or missing pm2_env'), {});

    // Merge env into pm2_env.env
    if (opts.env) {
      Utility.extend(proc.pm2_env, opts.env);
      Utility.extend(proc.pm2_env.env, opts.env); // why both?
    }

    // Merge current_conf directly into pm2_env
    Utility.extendExtraConfig(proc, opts);

    return cb(null, Utility.clone(proc.pm2_env));
  };
};
