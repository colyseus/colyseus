# Changelog

## 0.17.8

- Matchmaking queries now recover once Redis is back. A single failed read used to make every later `query()` fail until the process restarted. Thanks @rapina!

## 0.17.7

- Accept a `Redis` or `Cluster` client instance in the constructor (#928)

## 0.17.6

- Initial changelog entry

