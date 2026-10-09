# Changelog

## 0.17.8

- Matchmaking queries now recover once Redis is back. A single failed read used to make every later `query()` fail until the process restarted. Thanks @rapina!
- Redis connection errors are now logged as a one-line warning through the Colyseus `logger`, instead of ioredis's "Unhandled error event" stack trace.

## 0.17.7

- Accept a `Redis` or `Cluster` client instance in the constructor (#928)

## 0.17.6

- Initial changelog entry

