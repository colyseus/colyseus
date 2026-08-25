# Changelog

## 0.18.3

- The panel now works at any express mount path — `app.use("/stats", monitor())` no longer requires a matching `prefix` option.

- The bare-path redirect (`/monitor` → `/monitor/`) is now a 302, so browsers no longer cache it permanently.

## 0.18.2

- Fix the CommonJS build crashing on import, which also took down `require("colyseus")`.

- Node.js 22 is now the declared minimum (`engines`).

## 0.17.8

- Allow editing and deleting room state values from the monitor panel
- Replace `react-json-edit` and `react18-json-view` with `json-edit-react`
- Redesigned UI: stat cards, cleaner layout, better spacing

## 0.17.7

- Initial changelog entry

