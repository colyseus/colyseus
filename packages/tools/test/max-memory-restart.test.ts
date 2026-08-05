/**
 * `max_memory_restart` is derived from the instance's RAM rather than a fixed
 * value. A fixed 512M starved large plans (a 4GB/2-worker box was capped at 1GB
 * of 4GB) and overcommitted small ones (1GB/1-worker exceeded 100% of RAM during
 * a rolling deploy, and swap is disabled on Cloud instances).
 */
import assert from 'assert';
import fs from 'fs';
import os from 'os';
import path from 'path';
import v8 from 'v8';

const shared = require('../pm2/shared.cjs');

const GB = 1024 * 1024 * 1024;

/** Peak process count during a rolling deploy (see post-deploy-agent). */
const peakProcesses = (instances: number) => instances + Math.ceil(instances / 2);

function withTotalMem<T>(gigabytes: number, fn: () => T): T {
  const original = os.totalmem;
  (os as any).totalmem = () => gigabytes * GB;
  try {
    return fn();
  } finally {
    (os as any).totalmem = original;
  }
}

function writeEcosystem(fileName: string, app: Record<string, any>) {
  const filePath = path.join(__dirname, fileName);
  fs.writeFileSync(filePath, `module.exports = { apps: [${JSON.stringify(app)}] };\n`);
  return filePath;
}

describe('max_memory_restart default', () => {

  // 1GB/1 is the tightest plan: 1 worker plus 1 spawned during deploy
  const PLANS: Array<[number, number]> = [[1, 1], [2, 1], [2, 2], [4, 2], [8, 4], [16, 8]];

  it('should keep the rolling-deploy peak within the instance RAM', () => {
    // ~450MB measured on a Cloud node: OS + nginx + pm2 daemon + agent + report-stats
    const OVERHEAD_MB = 450;

    for (const [gb, instances] of PLANS) {
      const limitMB = withTotalMem(gb, () => shared.defaultMaxMemoryRestartMB(instances));
      const peakMB = limitMB * peakProcesses(instances) + OVERHEAD_MB;

      assert.ok(
        peakMB < gb * 1024,
        `${gb}GB/${instances} instances: deploy peak ${Math.round(peakMB)}MB exceeds ${gb * 1024}MB`,
      );
    }
  });

  it('should scale with the available RAM', () => {
    const small = withTotalMem(2, () => shared.defaultMaxMemoryRestartMB(2));
    const large = withTotalMem(8, () => shared.defaultMaxMemoryRestartMB(2));
    assert.ok(large > small, `expected 8GB (${large}M) to allow more than 2GB (${small}M)`);
  });

  it('should give a 4GB / 2-worker plan noticeably more than the old fixed 512M', () => {
    const limitMB = withTotalMem(4, () => shared.defaultMaxMemoryRestartMB(2));
    assert.ok(limitMB > 512, `expected more than 512M, got ${limitMB}M`);
  });

  it('should never drop below a usable floor', () => {
    // absurdly small box: the clamp keeps Node from thrashing on restarts
    const limitMB = withTotalMem(0.25, () => shared.defaultMaxMemoryRestartMB(4));
    assert.ok(limitMB >= 256, `expected at least 256M, got ${limitMB}M`);
  });

  it('should stay under V8 heap ceiling so PM2 restarts before an OOM crash', () => {
    const heapCeilingMB = v8.getHeapStatistics().heap_size_limit / 1024 / 1024;
    const limitMB = withTotalMem(256, () => shared.defaultMaxMemoryRestartMB(1));
    assert.ok(
      limitMB < heapCeilingMB,
      `expected below V8 ceiling ${Math.round(heapCeilingMB)}M, got ${limitMB}M`,
    );
  });

  describe('getAppConfig', () => {
    const written: string[] = [];
    after(() => written.forEach((f) => fs.existsSync(f) && fs.unlinkSync(f)));

    it('should apply the derived default when unset', async () => {
      const file = writeEcosystem('__mem-default.config.cjs', { name: 'a', script: 'x.js', instances: 2 });
      written.push(file);

      const config = await shared.getAppConfig(file);
      const derived = shared.defaultMaxMemoryRestartMB(2);
      assert.strictEqual(`${derived}M`, config.apps[0].max_memory_restart);
    });

    it('should never override an explicit value', async () => {
      const file = writeEcosystem('__mem-explicit.config.cjs', {
        name: 'b', script: 'x.js', instances: 2, max_memory_restart: '1500M',
      });
      written.push(file);

      const config = await shared.getAppConfig(file);
      assert.strictEqual('1500M', config.apps[0].max_memory_restart);
      // also mirrored into env, in bytes, so PM2's merge can't drop it
      assert.strictEqual(1500 * 1024 * 1024, config.apps[0].env.max_memory_restart);
    });

    it('should treat instances: 0 as one per core', async () => {
      const file = writeEcosystem('__mem-zero.config.cjs', { name: 'c', script: 'x.js', instances: 0 });
      written.push(file);

      const config = await shared.getAppConfig(file);
      const expected = shared.defaultMaxMemoryRestartMB(shared.MAX_ACTIVE_PROCESSES);
      assert.strictEqual(`${expected}M`, config.apps[0].max_memory_restart);
    });
  });

});
