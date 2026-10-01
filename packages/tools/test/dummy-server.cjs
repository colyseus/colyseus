#!/usr/bin/env node
/**
 * Dummy server for PM2 deployment testing.
 * Sends 'ready' signal to PM2 after startup.
 */
const http = require('http');
const fs = require('fs');
const path = require('path');

const INSTANCE_ID = Number(process.env.NODE_APP_INSTANCE || 0);

// Deliberately collides if two workers share an instance number -- that is the
// failure the deploy tests exist to catch, so it must not be hidden.
const PORT = 43000 + INSTANCE_ID;

const server = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({
    instance: INSTANCE_ID,
    pid: process.pid,
    uptime: process.uptime()
  }));
});

// Opt-in: boot this long before listening, like an app connecting to a
// database first. 'ready' is only sent once listening. Read from a file, not
// env: PM2 scales a rollout's new workers by cloning an existing one's env.
const LISTEN_DELAY_FILE = path.join(__dirname, '.listen-delay-ms');
const LISTEN_DELAY_MS = fs.existsSync(LISTEN_DELAY_FILE) ? Number(fs.readFileSync(LISTEN_DELAY_FILE, 'utf8')) : 0;

setTimeout(() => server.listen(PORT, () => {
  const boundPort = server.address().port;
  console.log(`[Instance ${INSTANCE_ID}] Dummy server running on port ${boundPort} (PID: ${process.pid})`);

  // Opt-in: grow the heap until PM2 trips max_memory_restart. Off by default so
  // deploy tests can count processes without them restarting underneath.
  if (process.env.LEAK_MEMORY) {
    const memoryLeak = [];
    setInterval(() => {
      // Allocate array with ~50MB of strings (stored in V8 heap)
      memoryLeak.push(new Array(512 * 512).fill('x'.repeat(10)));
      const usedMB = Math.round(process.memoryUsage().heapUsed / 1024 / 1024);
      console.log(`[Instance ${INSTANCE_ID}] Heap used: ${usedMB} MB (leaked chunks: ${memoryLeak.length})`);
    }, 100);
  }

  // Signal PM2 that the process is ready
  if (process.send) {
    process.send('ready');
  }
}), LISTEN_DELAY_MS);

// Opt-in: also bind the unix socket report-stats probes, so a test can tell a
// live worker from a draining one the same way the Cloud monitor does.
if (process.env.UNIX_SOCK_PATH) {
  const sockPath = path.join(process.env.UNIX_SOCK_PATH, `${2567 + INSTANCE_ID}.sock`);
  fs.mkdirSync(process.env.UNIX_SOCK_PATH, { recursive: true });
  fs.rmSync(sockPath, { force: true }); // a previous run's stale socket refuses to bind
  http.createServer((req, res) => res.end('ok')).listen(sockPath);
}

// Graceful shutdown
process.on('SIGINT', gracefulShutdown);
process.on('SIGTERM', gracefulShutdown);

function gracefulShutdown() {
  // Opt-in: never finish shutting down, so the process sits in 'stopping' for
  // as long as kill_timeout allows and a test can observe it there.
  if (process.env.HANG_ON_SHUTDOWN) {
    console.log(`[Instance ${INSTANCE_ID}] Ignoring shutdown signal (HANG_ON_SHUTDOWN).`);
    return;
  }

  // Opt-in: one instance drains for DRAIN_MS before closing, like a room
  // finishing its game, so a test can order which process settles first.
  const drainMs = (process.env.DRAIN_INSTANCE === 'all' || Number(process.env.DRAIN_INSTANCE) === INSTANCE_ID)
    ? Number(process.env.DRAIN_MS || 0)
    : 0;

  console.log(`[Instance ${INSTANCE_ID}] Received shutdown signal, closing server in ${drainMs}ms...`);
  setTimeout(() => server.close(() => {
    console.log(`[Instance ${INSTANCE_ID}] Server closed.`);
    process.exit(0);
  }), drainMs);
}
