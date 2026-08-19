# Changelog

## 0.18.3

- The bare-path redirect (`/admin` → `/admin/`) is now a 302, so browsers no longer cache it permanently.

## 0.18.2

- Fix the published package shipping without its `build/` directory, so nothing it exported could be resolved. 0.18.0 and 0.18.1 are unusable.

- Node.js 22 is now the declared minimum (`engines`).
