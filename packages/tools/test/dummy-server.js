#!/usr/bin/env node
/**
 * Dummy server for PM2 deployment testing.
 * Sends 'ready' signal to PM2 after startup.
 */
const http = require('http');

const INSTANCE_ID = Number(process.env.NODE_APP_INSTANCE || 0);
const PORT = (process.env.PORT || 3000) + INSTANCE_ID;

const server = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({
    instance: INSTANCE_ID,
    pid: process.pid,
    uptime: process.uptime()
  }));
});

server.listen(PORT, () => {
  console.log(`[Instance ${INSTANCE_ID}] Dummy server running on port ${PORT} (PID: ${process.pid})`);

  // Start leaking memory here to check when PM2 will automatic restart the process
  const memoryLeak = [];
  setInterval(() => {
    // Allocate array with ~50MB of strings (stored in V8 heap)
    memoryLeak.push(new Array(512 * 512).fill('x'.repeat(10)));
    const usedMB = Math.round(process.memoryUsage().heapUsed / 1024 / 1024);
    console.log(`[Instance ${INSTANCE_ID}] Heap used: ${usedMB} MB (leaked chunks: ${memoryLeak.length})`);
  }, 100);

  // Signal PM2 that the process is ready
  if (process.send) {
    process.send('ready');
  }
});

// Graceful shutdown
process.on('SIGINT', gracefulShutdown);
process.on('SIGTERM', gracefulShutdown);

function gracefulShutdown() {
  console.log(`[Instance ${INSTANCE_ID}] Received shutdown signal, closing server...`);
  server.close(() => {
    console.log(`[Instance ${INSTANCE_ID}] Server closed.`);
    process.exit(0);
  });
}
