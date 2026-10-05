const fs = require('fs');
const os = require('os');
const path = require('path');

/**
 * Environment variables set on the Colyseus Cloud panel, as the panel writes them for
 * ecosystem evaluation (see `colyseus-release.sh env` in the Cloud repo).
 *
 * The app process itself keeps receiving them from `.env.cloud` (src/loadenv.ts): this file
 * only exists so that `process.env.X` inside ecosystem.config.* sees what the app sees.
 */
function runtimeEnvFile() {
  return process.env.COLYSEUS_RUNTIME_ENV_FILE
    || path.join(os.homedir(), '.colyseus', 'env', 'runtime.json');
}

/**
 * @returns {Record<string, string>} empty when the file is missing or unreadable
 */
function readRuntimeEnv(file = runtimeEnvFile()) {
  let env;
  try {
    env = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (e) {
    if (e.code !== 'ENOENT') {
      console.warn(`[@colyseus/tools] ignoring ${file}: ${e.message}`);
    }
    return {};
  }

  if (!env || typeof env !== 'object' || Array.isArray(env)) { return {}; }

  const out = {};
  for (const [key, value] of Object.entries(env)) {
    if (typeof value === 'string') { out[key] = value; }
  }
  return out;
}

/**
 * `require()` an ecosystem file fresh, with the panel's variables in `process.env` while it
 * evaluates.
 *
 * Synchronous from start to end, so a concurrent deploy in the same agent never sees another
 * one's variables. Afterwards only what this function injected is undone: a value the
 * ecosystem file changed itself (e.g. through dotenv) is left as the file set it.
 *
 * @param {string} ecosystemFilePath
 * @param {Record<string, string>} [env]
 */
function requireEcosystem(ecosystemFilePath, env = readRuntimeEnv()) {
  const previous = {};
  for (const key of Object.keys(env)) {
    previous[key] = process.env[key];
    process.env[key] = env[key];
  }

  try {
    delete require.cache[require.resolve(ecosystemFilePath)];
    return require(ecosystemFilePath);

  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (process.env[key] !== env[key]) { continue; }

      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
}

module.exports = {
  runtimeEnvFile,
  readRuntimeEnv,
  requireEcosystem,
};
