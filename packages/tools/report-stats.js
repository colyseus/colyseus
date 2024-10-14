#!/usr/bin/env node

const fs = require('fs');
const net = require('net');
const pm2 = require('pm2');

const COLYSEUS_CLOUD_URL = `${process.env.ENDPOINT}/vultr/stats`;

const FAILED_ATTEMPS_FILE = "/var/tmp/pm2-stats-attempts.txt";
const FETCH_TIMEOUT = 7000;

async function retryFailedAttempts() {
  /**
   * Retry cached failed attempts
   */
  if (!fs.existsSync(FAILED_ATTEMPS_FILE)) {
    return;
  }

  // Retry up to last 30 attempts
  const failedAttempts = fs.readFileSync(FAILED_ATTEMPS_FILE, "utf8").split("\n").slice(-30);

  for (const body of failedAttempts) {
    // skip if empty
    if (!body) { continue; }

    try {
      await fetch(COLYSEUS_CLOUD_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${process.env.COLYSEUS_SECRET}`,
          "ngrok-skip-browser-warning": "yes",
        },
        body,
        signal: AbortSignal.timeout(FETCH_TIMEOUT)
      });
    } catch (e) {
      console.error(e);
    }
  }

  fs.unlinkSync(FAILED_ATTEMPS_FILE);
}

async function fetchRetry(url, options, retries = 3) {
  try {
    return await fetch(url, options)
  } catch (err) {
    if (retries === 1) throw err;
    return await fetchRetry(url, options, retries - 1);
  }
};

pm2.Client.executeRemote('getMonitorData', {}, async function(err, list) {
  const aggregate = { ccu: 0, roomcount: 0, };
  const apps = {};

  await Promise.all(list.map(async (item) => {
    const env = item.pm2_env;
    const app_id = env.pm_id;
    const uptime = new Date(env.pm_uptime); // uptime in milliseconds
    const axm_monitor = env.axm_monitor;
    const restart_time = env.restart_time;
    const status = env.status; // 'online', 'stopped', 'stopping', 'waiting restart', 'launching', 'errored'
    const node_version = env.node_version;

    const monit = {
      cpu: item.monit.cpu, // 0 ~ 100 (%)
      memory: item.monit.memory / 1024 / 1024, // in MB
    };

    const version = {};
    if (env.versioning) {
      version.revision = env.versioning.revision;
      version.comment = env.versioning.comment;
      version.branch = env.versioning.branch;
      version.update_time = env.versioning.update_time;
    }

    aggregate.ccu += axm_monitor.ccu?.value ?? 0;
    aggregate.roomcount += axm_monitor.roomcount?.value ?? 0;

    const custom_monitor = {};
    for (const originalKey in axm_monitor) {
      const key = (originalKey.indexOf(" ") !== -1)
        ? axm_monitor[originalKey].type
        : originalKey;
      custom_monitor[key] = Number(axm_monitor[originalKey].value);
    }

    // check if process .sock file is active
    const socket_is_active = await checkSocketIsActive(`/run/colyseus/${(2567 + env.NODE_APP_INSTANCE)}.sock`);

    apps[app_id] = {
      pid: item.pid,
      uptime,
      app_id,
      status,
      restart_time,
      ...monit,
      ...custom_monitor,
      version,
      node_version,
      socket_is_active,
    };
  }));

  const fetchipv4 = await fetch("http://169.254.169.254/v1.json");
  const ip = (await fetchipv4.json()).interfaces[0].ipv4.address;

  const body = {
    version: 1,
    ip,
    time: new Date(),
    aggregate,
    apps,
  };

  console.log(body);

  try {
    const response = await fetchRetry(COLYSEUS_CLOUD_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${process.env.COLYSEUS_SECRET}`,
        "ngrok-skip-browser-warning": "yes",
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(FETCH_TIMEOUT)
    });

    if (response.status !== 200) {
      throw new Error(`Failed to send stats to Colyseus Cloud. Status: ${response.status}`);
    }

    console.log("OK");

    // Only retry failed attempts if the current attempt was successful
    await retryFailedAttempts();

  } catch (e) {
    console.error("Failed to send stats to Colyseus Cloud. ");

    // cache failed attempts
    fs.appendFileSync(FAILED_ATTEMPS_FILE, JSON.stringify(body) + "\n");

  } finally {
    process.exit();
  }
});

function checkSocketIsActive(sockFilePath) {
  return new Promise((resolve, _) => {
    const client = net.createConnection({ path: sockFilePath, timeout: 5000 })
      .on('connect', () => {
        client.end(); // close the connection
        resolve(true);
      })
      .on('error', () => resolve(false))
      .on('timeout', () => resolve(false));
  });
}
