# Changelog

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

