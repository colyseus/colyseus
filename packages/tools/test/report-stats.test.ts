/**
 * report-stats end-to-end
 *
 * Runs the real `report-stats.cjs` against a live PM2 daemon and a stub Cloud
 * endpoint, and asserts on the POST body the Cloud would actually receive --
 * the payload is what the dashboard's process list renders.
 *
 * Usage:
 *   npx mocha --import tsx test/report-stats.test.ts --timeout 60000
 */
import pm2 from 'pm2';
import http from 'http';
import path from 'path';
import fs from 'fs';
import os from 'os';
import assert from 'assert';
import { spawn } from 'child_process';

const TOOLS_PACKAGE_PATH = path.resolve(__dirname, '..');
const REPORT_STATS_PATH = path.join(TOOLS_PACKAGE_PATH, 'report-stats.cjs');
const DUMMY_SERVER_PATH = path.join(__dirname, 'dummy-server.cjs');

const PM2_APP_NAME = 'report-stats-test-app';

// stand-ins for the instance-only paths report-stats reads in production
const SOCK_DIR = path.join(os.tmpdir(), 'colyseus-report-stats-test');
const ATTEMPTS_FILE = path.join(SOCK_DIR, 'attempts.txt');

// the window a hung worker stays 'stopping' -- long enough to report on it,
// short enough that waiting for the SIGKILL doesn't drag the suite out
const KILL_TIMEOUT = 8000;

type App = {
  app_id: number;
  status: string;
  socket_is_active?: boolean;
};

type StatsBody = {
  ip: string;
  apps: Record<string, App>;
  aggregate: { ccu: number; roomcount: number };
};

/**
 * Stub of the two HTTP endpoints report-stats talks to on a real instance:
 * the Vultr metadata service, and the Cloud's /vultr/stats collector.
 */
function startStubCloud(): Promise<{ url: string; received: StatsBody[]; close: () => Promise<void> }> {
  const received: StatsBody[] = [];

  const server = http.createServer((req, res) => {
    if (req.url === '/metadata') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ interfaces: [{ ipv4: { address: '10.0.0.1' } }] }));
    }

    let body = '';
    req.on('data', (chunk) => body += chunk);
    req.on('end', () => {
      received.push(JSON.parse(body));
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: 'ok' }));
    });
  });

  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as { port: number };
      resolve({
        url: `http://127.0.0.1:${port}`,
        received,
        close: () => new Promise<void>((done) => server.close(() => done())),
      });
    });
  });
}

/** Run the real script the way cron does, and hand back what the Cloud got. */
function runReportStats(stubUrl: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [REPORT_STATS_PATH], {
      env: {
        ...process.env,
        ENDPOINT: stubUrl,
        INSTANCE_METADATA_URL: `${stubUrl}/metadata`,
        UNIX_SOCK_PATH: `${SOCK_DIR}/`,
        STATS_ATTEMPTS_FILE: ATTEMPTS_FILE,
        // the script would otherwise load the app's .env.cloud over our stubs
        APP_ROOT_PATH: '',
      },
      stdio: 'ignore',
    });
    child.on('error', reject);
    child.on('exit', () => resolve());
  });
}

function listApps(): Promise<pm2.ProcessDescription[]> {
  return new Promise((resolve, reject) => {
    pm2.list((err, apps) => {
      if (err) return reject(err);
      resolve(apps.filter(app => app.name === PM2_APP_NAME));
    });
  });
}

function waitForStatus(status: string, timeout = 20000): Promise<pm2.ProcessDescription> {
  const startTime = Date.now();

  return new Promise((resolve, reject) => {
    const check = async () => {
      const app = (await listApps()).find(app => app.pm2_env?.status === status);
      if (app) { return resolve(app); }

      if (Date.now() - startTime > timeout) {
        const seen = (await listApps()).map(a => a.pm2_env?.status);
        return reject(new Error(`Timeout waiting for '${status}', saw: ${seen}`));
      }
      setTimeout(check, 250);
    };
    check();
  });
}

function startWorkers(instances: number): Promise<void> {
  return new Promise((resolve, reject) => {
    pm2.start({
      name: PM2_APP_NAME,
      script: DUMMY_SERVER_PATH,
      instances,
      exec_mode: 'fork',
      wait_ready: true,
      kill_timeout: KILL_TIMEOUT,
      env: {
        UNIX_SOCK_PATH: `${SOCK_DIR}/`,
        HANG_ON_SHUTDOWN: '1',
      },
    } as any, (err) => err ? reject(err) : resolve());
  });
}

function cleanup(): Promise<void> {
  return new Promise((resolve) => pm2.delete(PM2_APP_NAME, () => resolve()));
}

describe('report-stats payload', function () {
  this.timeout(90000);

  let stub: Awaited<ReturnType<typeof startStubCloud>>;

  // pm2.stop() calls back only once the process is gone, i.e. after
  // kill_timeout -- awaiting it would skip the 'stopping' window entirely
  let draining: Promise<void>;

  before(async function () {
    fs.rmSync(SOCK_DIR, { recursive: true, force: true });
    fs.mkdirSync(SOCK_DIR, { recursive: true });

    await new Promise<void>((resolve, reject) =>
      pm2.connect((err) => err ? reject(err) : resolve()));

    await cleanup();
    stub = await startStubCloud();
  });

  after(async function () {
    await cleanup();
    await stub?.close();
    fs.rmSync(SOCK_DIR, { recursive: true, force: true });
    pm2.disconnect();
  });

  it('should report an online worker with a live socket', async function () {
    await startWorkers(1);
    const online = await waitForStatus('online');

    await runReportStats(stub.url);

    const body = stub.received.at(-1)!;
    const app = body.apps[String(online.pm_id)];

    assert.ok(app, `pm_id ${online.pm_id} missing from: ${Object.keys(body.apps)}`);
    assert.strictEqual(app.status, 'online');
    assert.strictEqual(app.socket_is_active, true);
  });

  //
  // The Cloud process list blinks red on 'stopping'. Filtering those out of the
  // payload made a draining worker vanish from the dashboard instead.
  //
  it('should keep a draining worker in the payload, without a socket verdict', async function () {
    const online = await waitForStatus('online');

    // HANG_ON_SHUTDOWN keeps it here for kill_timeout, rather than exiting
    draining = new Promise<void>((resolve) => pm2.stop(online.pm_id!, () => resolve()));
    const stopping = await waitForStatus('stopping');

    await runReportStats(stub.url);

    const body = stub.received.at(-1)!;
    const app = body.apps[String(stopping.pm_id)];

    assert.ok(app, `draining worker ${stopping.pm_id} dropped from: ${Object.keys(body.apps)}`);
    assert.strictEqual(app.status, 'stopping');

    // no probe ran, so no verdict is sent -- the Cloud's inactive-socket
    // monitor skips the key entirely rather than reading it as a dead worker
    assert.ok(
      !('socket_is_active' in app),
      `expected no socket verdict, got ${JSON.stringify(app.socket_is_active)}`
    );
  });

  it('should drop a fully stopped worker from the payload', async function () {
    // let kill_timeout expire, so the hung worker gets its SIGKILL
    await draining;
    const stopped = await waitForStatus('stopped');

    await runReportStats(stub.url);

    const body = stub.received.at(-1)!;

    assert.ok(
      !(String(stopped.pm_id) in body.apps),
      `stopped worker ${stopped.pm_id} should not be reported`
    );
  });
});
