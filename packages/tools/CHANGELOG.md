# Changelog

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

