# Changelog

## 0.18.3

- `cleanup()` now waits for the driver to finish clearing the room cache. With a database- or Redis-backed driver, the previous test's wipe could land after the next test's `createRoom()` and fail it with `room "..." not found`.

## 0.18.2

- Renamed `room.waitForNextSimulationTick()` to **`room.waitForNextTimestep()`**, pairing with the `setSimulationInterval()` → `setTimestep()` rename in 0.18. The old name still works — it forwards unchanged and is marked `@deprecated` — so this is **not** a breaking change. It will be removed in 0.19. The helper works with either loop: `setTimestep()` and `setFixedTimestep()` both drive the same underlying interval.
- Fix the warning logged when the helper is called on a room with no loop configured. It read `"⚠️ waitForSimulation() - .setSimulationInterval() is a must."`, naming a method that has never existed and pointing at the deprecated setter. It now names the real method and recommends `setTimestep()` / `setFixedTimestep()`.

## 0.17.11

- Initial changelog entry

