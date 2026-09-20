# Changelog

## 0.18.4

- The "Memory" card now shows the resident memory of the Colyseus process serving the panel instead of system-wide usage — hover it to see which process that is. The API keeps `totalMemMb`/`usedMemMb` and adds `memory.rssMb` and `memory.processId`. Thanks @fatihcvs! [#969](https://github.com/colyseus/colyseus/pull/969)

- Stat cards and room actions no longer push the panel wider than the viewport on phones. Thanks @fatihcvs! [#970](https://github.com/colyseus/colyseus/pull/970)

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

