# Changelog

## 0.18.8

- Deploying again while the previous deploy's players are still finishing their games no longer leaves new players unable to join. The new version starts alongside when the server has the memory for it, otherwise it goes live as soon as a draining process exits; the deploy log says when it's waiting.
- After a deploy, every process takes new players again. One restarted during the deploy could stay out of rotation until the next deploy.
- Apps that take more than 3 seconds to start no longer receive players (502s) before they're listening.
- `colyseus-post-deploy` no longer hangs on a deploy right after another one, and overlapping deploys each report their own result.
- A `kill_timeout` shorter than 5 seconds no longer marks cleanly stopped processes as errored.

## 0.18.7

- After a server reboot on Colyseus Cloud, the next deploy no longer disconnects players. The app came back from the reboot without its 30-minute shutdown grace period, so that deploy stopped the old processes after 1.6 seconds instead of waiting for their rooms to finish.

## 0.18.6

- The `colyseus-report-stats` script on Colyseus Cloud no longer prints dotenv's log either.

## 0.18.5

- dotenv's own "injecting env" log line is silenced on startup; the `✅ .env loaded.` line still reports which file was loaded.

## 0.18.4

- `require()` of this package now resolves to the same ESM build `import` gets, so a process that uses both no longer loads two copies. [#979](https://github.com/colyseus/colyseus/issues/979)

## 0.18.3

Brings in the 0.17.21 and 0.17.22 fixes.

- Fixed a process leak on single-worker deployments: each deploy could leave one
  extra PM2 process behind, growing without bound — one app reached 29 processes
  on a 1GB instance, with NGINX routing all traffic to a single one. The first
  deploy on this version reclaims the surplus automatically.
- Processes that are still starting or shutting down are no longer reported to
  the Colyseus Cloud monitor as having a dead socket, so deploys no longer
  trigger spurious "inactive socket" alerts — which restarted the very processes
  the deploy had just stopped.
- Workers that are starting up or draining appear in the Colyseus Cloud process
  list, showing red until they are gone instead of vanishing from the dashboard.
- The PM2 process list is saved after every deploy, so a machine reboot restores
  what was actually running instead of a stale list.

## 0.18.2

- Derive the default `max_memory_restart` from the instance's RAM instead of a
  fixed `512M`. The old value starved larger plans — a 4GB box running 2 workers
  was capped at 1GB of 4GB, restarting healthy processes every couple of hours —
  and overcommitted a 1GB plan, whose rolling-deploy peak exceeded total RAM
  (swap is disabled on Cloud instances).

  The limit is sized against a rolling deploy, which briefly runs
  `instances + ceil(instances / 2)` processes, and stays under V8's heap ceiling
  so PM2 restarts gracefully rather than the process hard-crashing on OOM.

  An explicit `max_memory_restart` in `ecosystem.config.js` is still respected.

## 0.17.16

- Initial changelog entry

