/**
 * Variables set on the Colyseus Cloud panel reach ecosystem.config.* while the agent (or the
 * legacy post-deploy CLI) evaluates it -- and nothing else in the agent's long-lived env.
 */
import assert from 'assert';
import fs from 'fs';
import os from 'os';
import path from 'path';

const cloudEnv = require('../pm2/cloud-env.cjs');
const shared = require('../pm2/shared.cjs');

describe('Cloud panel env during ecosystem evaluation', () => {
  let dir: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cloud-env-'));
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
    delete process.env.COLYSEUS_RUNTIME_ENV_FILE;
  });

  function ecosystem(body: string) {
    const file = path.join(dir, `ecosystem-${Math.random().toString(36).slice(2)}.config.cjs`);
    fs.writeFileSync(file, body);
    return file;
  }

  it('should expose the panel variables to the ecosystem file', () => {
    const file = ecosystem(`module.exports = { apps: [{ script: 'x.js', instances: Number(process.env.WORKERS), env: { API: process.env.API_URL } }] };`);

    const config = cloudEnv.requireEcosystem(file, { WORKERS: '3', API_URL: 'https://api' });

    assert.strictEqual(config.apps[0].instances, 3);
    assert.strictEqual(config.apps[0].env.API, 'https://api');
  });

  it('should leave process.env as it found it', () => {
    process.env.CLOUD_ENV_EXISTING = 'before';
    const before = { ...process.env };

    cloudEnv.requireEcosystem(ecosystem(`module.exports = { apps: [] };`), { CLOUD_ENV_EXISTING: 'panel', CLOUD_ENV_NEW: 'panel' });

    assert.deepStrictEqual({ ...process.env }, before);
    delete process.env.CLOUD_ENV_EXISTING;
  });

  it('should keep what the ecosystem file itself set', () => {
    const file = ecosystem(`process.env.CLOUD_ENV_OWN = 'file'; process.env.CLOUD_ENV_SHARED = 'file'; module.exports = { apps: [] };`);

    cloudEnv.requireEcosystem(file, { CLOUD_ENV_SHARED: 'panel' });

    assert.strictEqual(process.env.CLOUD_ENV_OWN, 'file');
    assert.strictEqual(process.env.CLOUD_ENV_SHARED, 'file');
    delete process.env.CLOUD_ENV_OWN;
    delete process.env.CLOUD_ENV_SHARED;
  });

  it('should re-read the ecosystem file on every call', () => {
    const file = ecosystem(`module.exports = { apps: [{ instances: Number(process.env.WORKERS) }] };`);

    assert.strictEqual(cloudEnv.requireEcosystem(file, { WORKERS: '1' }).apps[0].instances, 1);
    assert.strictEqual(cloudEnv.requireEcosystem(file, { WORKERS: '2' }).apps[0].instances, 2);
  });

  it('should read the file the panel writes, and shrug off a missing or broken one', () => {
    const file = path.join(dir, 'runtime.json');
    assert.deepStrictEqual(cloudEnv.readRuntimeEnv(file), {});

    fs.writeFileSync(file, '{"A":"1","B":2,"C":null}');
    assert.deepStrictEqual(cloudEnv.readRuntimeEnv(file), { A: '1' });

    fs.writeFileSync(file, '{not json');
    assert.deepStrictEqual(cloudEnv.readRuntimeEnv(file), {});

    fs.writeFileSync(file, '["A"]');
    assert.deepStrictEqual(cloudEnv.readRuntimeEnv(file), {});
  });

  it('should be what getAppConfig() evaluates the ecosystem with', async () => {
    const envFile = path.join(dir, 'runtime.json');
    fs.writeFileSync(envFile, JSON.stringify({ WORKERS: '2' }));
    process.env.COLYSEUS_RUNTIME_ENV_FILE = envFile;

    const config = await shared.getAppConfig(ecosystem(`module.exports = { apps: [{ script: 'x.js', instances: Number(process.env.WORKERS) }] };`));

    assert.strictEqual(config.apps[0].instances, 2);
    assert.strictEqual(process.env.WORKERS, undefined);
  });
});
