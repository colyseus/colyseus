# Changelog

## 0.17.8

- Fix dynamic 'origin' detection during OAuth. Before this change you were required to manually set `auth.oauth.defaults.origin` per environment for some OAuth providers (e.g. `twitch`). Now the `origin` can be auto-detected.

## 0.17.7

- Fix Express origin/backend_url detector utility for OAuth.

