/**
 * Rolling-deploy planning.
 *
 * A 1-worker plan (every 1-vCPU Cloud instance, where `instances` defaults to
 * `os.cpus().length`) grew by one process on every deploy: the agent scaled to
 * `apps.length + ceil(instances / 2)` — relative to the live process count
 * rather than to the desired one — so nothing ever brought the count back down.
 * One customer reached 29 processes on a 1GB box, all but one of them idle,
 * with NGINX pointing at a single upstream.
 *
 * The growth needs the stopped processes to come back between deploys, which is
 * exactly what the inactive-socket monitor did: it read a process PM2 was still
 * tearing down as a dead socket and restarted it. Both halves are covered here.
 */
import assert from 'assert';

const { planRollout, planDrain, planReclaim, newProcesses, socketPort } = require('../pm2/rollout.cjs');
const { peakProcesses, hasSettledSocket } = require('../pm2/shared.cjs');

type Proc = { pm_id: number; NODE_APP_INSTANCE: number; status: string };

/** Minimal stand-in for the PM2 daemon's view of one app's processes. */
class Pm2Sim {
  procs: Proc[] = [];
  private nextPmId = 1;

  constructor(instances: number) {
    for (let i = 0; i < instances; i++) { this.spawn(); }
  }

  /** PM2 fills the lowest free instance number, not highest + 1. */
  spawn() {
    const used = new Set(this.procs.map((p) => p.NODE_APP_INSTANCE));
    let NODE_APP_INSTANCE = 0;
    while (used.has(NODE_APP_INSTANCE)) { NODE_APP_INSTANCE++; }
    this.procs.push({ pm_id: this.nextPmId++, NODE_APP_INSTANCE, status: 'online' });
  }

  list() { return this.procs.map((p) => ({ name: 'app', pm2_env: p })); }
  byId(pm_id: number) { return this.procs.find((p) => p.pm_id === pm_id)!; }
  count(status?: string) {
    return status ? this.procs.filter((p) => p.status === status).length : this.procs.length;
  }
}

/**
 * Run one deploy through the planner and apply its decisions to the simulator
 * in the same order post-deploy-agent does: bring up, drain, reconcile.
 */
function deploy(sim: Pm2Sim, instances: number) {
  const before = sim.list();
  const plan = planRollout({ apps: before, instances });

  if (plan.scaleTo !== null) {
    for (let i = sim.count(); i < plan.scaleTo; i++) { sim.spawn(); }
  }
  const spawned = newProcesses(before, sim.list());
  plan.reuse.forEach((env: Proc) => { sim.byId(env.pm_id).status = 'online'; });
  const initialApps = spawned.concat(plan.reuse);

  const drain = planDrain({ appsToStop: plan.appsToStop, activeCount: initialApps.length, instances });
  drain.toStop.forEach((env: Proc) => { sim.byId(env.pm_id).status = 'stopped'; });

  // reconcile runs on a fresh list, after the drain
  const surplus = planReclaim({ apps: sim.list(), instances });
  surplus.forEach((env: Proc) => { sim.procs = sim.procs.filter((p) => p.pm_id !== env.pm_id); });

  return { plan, initialApps, surplus };
}

/** What the inactive-socket monitor did: restart anything it saw without a socket. */
function resurrectStopped(sim: Pm2Sim) {
  sim.procs.forEach((p) => { if (p.status === 'stopped') { p.status = 'online'; } });
}

describe('rolling deploy', () => {

  describe('process count', () => {

    it('should not grow across repeated deploys on a 1-worker plan', () => {
      const sim = new Pm2Sim(1);

      for (let i = 1; i <= 10; i++) {
        deploy(sim, 1);
        assert.ok(
          sim.count() <= peakProcesses(1),
          `after deploy ${i}: ${sim.count()} processes, expected at most ${peakProcesses(1)}`
        );
      }

      assert.strictEqual(sim.count('online'), 1, 'exactly one worker should serve traffic');
    });

    it('should not grow when the monitor resurrects the processes a deploy stopped', () => {
      const sim = new Pm2Sim(1);

      for (let i = 1; i <= 10; i++) {
        deploy(sim, 1);
        resurrectStopped(sim);
        assert.ok(
          sim.count() <= peakProcesses(1),
          `after deploy ${i}: ${sim.count()} processes, expected at most ${peakProcesses(1)}`
        );
      }
    });

    it('should hold a multi-worker plan at its rolling-deploy peak', () => {
      const sim = new Pm2Sim(4);

      for (let i = 1; i <= 10; i++) {
        deploy(sim, 4);
        assert.ok(
          sim.count() <= peakProcesses(4),
          `after deploy ${i}: ${sim.count()} processes, expected at most ${peakProcesses(4)}`
        );
      }
    });

    it('should never scale past the rolling-deploy peak', () => {
      for (const instances of [1, 2, 3, 4, 8, 16]) {
        const sim = new Pm2Sim(instances);

        for (let i = 0; i < 5; i++) {
          const { plan } = deploy(sim, instances);
          resurrectStopped(sim);

          if (plan.scaleTo !== null) {
            assert.ok(
              plan.scaleTo <= peakProcesses(instances),
              `instances=${instances}: scaled to ${plan.scaleTo}, peak is ${peakProcesses(instances)}`
            );
          }
        }
      }
    });

    it('should shed surplus processes left behind by earlier growth', () => {
      // the shape found in production: 29 slots, 1 worker's worth of config
      const sim = new Pm2Sim(29);
      sim.procs.forEach((p, i) => { if (i > 0) { p.status = 'stopped'; } });

      deploy(sim, 1);

      assert.ok(
        sim.count() <= peakProcesses(1),
        `expected the surplus to be reclaimed, still holding ${sim.count()} processes`
      );
      assert.strictEqual(sim.count('online'), 1);
    });

    it('should reclaim this deploy\'s own leftovers, not just earlier ones', () => {
      // reclaim must run on a fresh list after the drain, otherwise the
      // processes this deploy stopped are only eligible on the next one
      const sim = new Pm2Sim(3);
      const { surplus } = deploy(sim, 1);

      assert.ok(surplus.length > 0, 'nothing reclaimed on a box already over peak');
      assert.ok(sim.count() <= peakProcesses(1));
    });

    it('should spawn on a genuinely fresh deploy', () => {
      const sim = new Pm2Sim(1);
      const { plan } = deploy(sim, 1);

      assert.strictEqual(plan.toSpawn, 1);
      assert.strictEqual(plan.scaleTo, 2, 'one new worker alongside the outgoing one');
    });

    it('should spawn only what stopped slots cannot cover', () => {
      // instances=4 wants a generation of 2; one stopped slot is available,
      // so exactly one new process is needed -- not zero, not two
      const sim = new Pm2Sim(5);
      sim.procs[4].status = 'stopped';

      const plan = planRollout({ apps: sim.list(), instances: 4 });

      assert.strictEqual(plan.reuse.length, 1);
      assert.strictEqual(plan.toSpawn, 1);
      assert.strictEqual(plan.scaleTo, 6);
    });
  });

  describe('new generation', () => {

    it('should only ever bring up spawned or stopped processes', () => {
      // restarting a live worker in place turns a rolling deploy into a
      // downtime one -- and it may be the one NGINX is serving from
      for (const instances of [1, 2, 4]) {
        const sim = new Pm2Sim(instances);

        for (let i = 0; i < 5; i++) {
          const before = sim.list();
          const { plan, initialApps } = deploy(sim, instances);
          resurrectStopped(sim);

          const wasLive = new Set(before
            .filter((a) => a.pm2_env.status === 'online')
            .map((a) => a.pm2_env.pm_id));

          initialApps.forEach((env: Proc) => {
            assert.ok(
              !wasLive.has(env.pm_id) || plan.reuse.some((r: Proc) => r.pm_id === env.pm_id) === false,
              `instances=${instances}: live worker ${env.pm_id} was restarted into the new generation`
            );
          });
        }
      }
    });

    it('should read new processes back from PM2 rather than predict them', () => {
      // PM2 fills the lowest free instance number; on a box with a gap the
      // prediction `highest + 1` points NGINX at a socket nothing listens on
      const before = [
        { name: 'app', pm2_env: { pm_id: 1, NODE_APP_INSTANCE: 0, status: 'online' } },
        { name: 'app', pm2_env: { pm_id: 3, NODE_APP_INSTANCE: 2, status: 'online' } },
      ];
      const after = before.concat([
        { name: 'app', pm2_env: { pm_id: 4, NODE_APP_INSTANCE: 1, status: 'online' } },
      ]);

      const fresh = newProcesses(before, after);

      assert.deepStrictEqual(fresh.map((e: Proc) => e.NODE_APP_INSTANCE), [1]);
    });
  });

  describe('drain', () => {

    it('should stop rather than restart the outgoing worker on a 1-worker plan', () => {
      const drain = planDrain({
        appsToStop: [{ pm_id: 1 }],
        activeCount: 1,
        instances: 1,
      });

      assert.deepStrictEqual(drain.toRestart, []);
      assert.strictEqual(drain.toStop.length, 1);
    });
  });

  describe('reclaim', () => {

    it('should only ever delete stopped processes', () => {
      const apps = [
        { name: 'app', pm2_env: { pm_id: 1, NODE_APP_INSTANCE: 0, status: 'online' } },
        { name: 'app', pm2_env: { pm_id: 2, NODE_APP_INSTANCE: 1, status: 'stopping' } },
        { name: 'app', pm2_env: { pm_id: 3, NODE_APP_INSTANCE: 2, status: 'stopped' } },
        { name: 'app', pm2_env: { pm_id: 4, NODE_APP_INSTANCE: 3, status: 'online' } },
      ];

      const surplus = planReclaim({ apps, instances: 1 });

      assert.deepStrictEqual(surplus.map((e: Proc) => e.pm_id), [3]);
    });

    it('should drop the newest slots first so instance numbers stay compact', () => {
      const apps = [0, 1, 2, 3, 4].map((i) => (
        { name: 'app', pm2_env: { pm_id: i + 1, NODE_APP_INSTANCE: i, status: i === 0 ? 'online' : 'stopped' } }
      ));

      const surplus = planReclaim({ apps, instances: 1 });

      assert.deepStrictEqual(surplus.map((e: Proc) => e.NODE_APP_INSTANCE), [4, 3, 2]);
    });

    it('should sort numerically even when PM2 reports instance numbers as strings', () => {
      const apps = ['0', '2', '10'].map((i, idx) => (
        { name: 'app', pm2_env: { pm_id: idx + 1, NODE_APP_INSTANCE: i, status: idx === 0 ? 'online' : 'stopped' } }
      ));

      const surplus = planReclaim({ apps, instances: 1 });

      assert.deepStrictEqual(surplus.map((e: { NODE_APP_INSTANCE: string }) => e.NODE_APP_INSTANCE), ['10']);
    });
  });

  describe('socket port', () => {

    it('should number the socket from the instance, string or number', () => {
      assert.strictEqual(socketPort('0'), 2567);
      assert.strictEqual(socketPort('12'), 2579);
      assert.strictEqual(socketPort(0), 2567);
      assert.strictEqual(socketPort(12), 2579);
    });
  });

  describe('socket reporting', () => {

    it('should skip every status where the process has no socket to judge', () => {
      // an allowlist, because PM2's transitional statuses are many -- a denylist
      // of stopped/stopping/launching still reported 'waiting restart' as settled
      for (const status of ['stopped', 'stopping', 'launching', 'waiting restart', 'one-launch-status']) {
        assert.strictEqual(hasSettledSocket(status), false, status);
      }
    });

    it('should still report settled processes', () => {
      assert.strictEqual(hasSettledSocket('online'), true);
      assert.strictEqual(hasSettledSocket('errored'), true);
    });
  });
});
