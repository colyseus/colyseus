# Changelog

## 0.18.2

Brings in the 0.17.8 fix, which the published 0.18.1 predates.

- Fix subscriptions being silently lost on reconnect, leaving a process alive but
  unreachable over IPC (and so invisible to the matchmaker) while its `pub`
  connection kept working:
  - Disable the ready check on the subscriber connection. It issues `INFO`, which
    Redis rejects in subscriber mode; ioredis then skips `readyHandler()`, the only
    place `autoResubscribe` runs.
  - Re-subscribe every intended topic on `'ready'`. A `SUBSCRIBE` rejected
    mid-reconnect was never retried, and `autoResubscribe` cannot restore a channel
    it never saw succeed.
  - Attach `'error'` listeners to both connections, so failures no longer surface
    only as ioredis `Unhandled error event`.

## 0.17.7

- Accept a `Redis` or `Cluster` client instance in the constructor (#928)

## 0.17.6

- Initial changelog entry

