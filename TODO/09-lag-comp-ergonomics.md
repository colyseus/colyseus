# 09 — Lag-compensation ergonomics helper

> `allowRewindState` + `rewind.valueAt(entity, time, field)` is a clean core, but you still
> hand-store each player's `renderTime` and manually rewind targets to the shooter's view. Add a
> helper for the common "rewind to the acting client's render time" case.

- **Status:** Done (2026-06-09)
- **Priority:** P2
- **Area:** `packages/core` (`Rewind`)
- **Surfaced by:** server-side hit lag-comp in the shooter (2026-06-02)

## Resolution

Shipped `rewind.at(time)` (the decoupled primitive — clamp to `maxRewindMs` +
live-fallback baked in) and `rewind.lastSeenBy(sessionId)` (sugar that resolves the
client's auto-stamped render time, wired by `Room.allowRewindState` via the input
layer — no userland `renderTimes` map). View reads are shape-agnostic — the caller
names the fields: `view.value(e, field)` + `view.read(e, fields, out?)` (no baked-in
x/y/z). The clamp is mandatory in the helper (anti-spoof). Client side, the
SDK now stamps the render time fully (`serverNow − renderDelay − smoothedRtt/2`), so
userland passes only its interp buffer. All three reference rooms migrated; see
`PREDICTION.md`.

## Problem / friction

The rewind primitive is good, but the common pattern around it is boilerplate. In the shooter I
had to:

1. Manually store each player's render time every tick, because `input(sid).renderTime` reflects
   only the *most recently drained* input and I need it later during collision:
   ```ts
   if (frames.length > 0) this.renderTimes.set(sessionId, this.input(sessionId).renderTime);
   ```
2. In the bullet/collision pass, look up the **shooter's** render time, clamp it, and rewind each
   candidate target by hand:
   ```ts
   const ownerRenderTime = this.renderTimes.get(bullet.ownerId) ?? 0;
   const targetTime = ownerRenderTime > 0 ? Math.max(ownerRenderTime, now - this.rewind.maxRewindMs) : 0;
   const tx = targetTime > 0 ? this.rewind.valueAt(targetPlayer, targetTime, "x") : liveX;
   const ty = targetTime > 0 ? this.rewind.valueAt(targetPlayer, targetTime, "y") : liveY;
   ```

Every hitscan/projectile game rewrites this exact "rewind the world to where the acting client
saw it, clamped to maxRewindMs, with a live fallback" dance.

## Current state

- `packages/core/src/Rewind.ts`: `allowRewindState({maxRewindMs})` → `Rewind`; `attachAll(collection,
  {fields, interpolate})` records positions per tick (auto-recorded by the fixed-step loop);
  `valueAt(entity, time, field)`; `maxRewindMs` getter; per-entity `EntityHistory` ring with
  `linear`/`step` interpolation.
- `input(sid).renderTime` is the server-clock render time of the most recently drained input
  (auto-stamped when `defineInput({renderTime: true})`).

## Proposal

A higher-level helper for the dominant case — "evaluate a hit from the acting client's
viewpoint":

```ts
// Option A: a per-client rewound view, clamped + live-fallback handled internally.
const view = this.rewind.viewFor(shooterSessionId);   // uses that client's latest renderTime, clamped
const tx = view.x(targetEntity), ty = view.y(targetEntity);   // rewound positions (or live if no renderTime)

// Option B: a one-shot hit query.
const hit = this.rewind.test(shooterSessionId, targetEntity, (rewound) =>
  overlaps(bullet, rewound, hitRadius));
```

Also:

- **Track render time automatically** keyed by sessionId, so users don't keep a parallel
  `renderTimes` map. The `Rewind` (or the input layer) already sees `input.renderTime`; let it
  remember the latest per client and expose it (`rewind.renderTimeOf(sid)` / used internally by
  `viewFor`).
- Bake in the **clamp to `maxRewindMs`** and the **live fallback** (renderTime == 0 → use current
  position) that every caller re-implements.

## Implementation notes

- Keep the low-level `valueAt(entity, time, field)` — the helper is sugar over it.
- `viewFor(sid)` needs the client's latest render time; decide whether `Rewind` subscribes to the
  input layer or the room feeds it (the room already calls the fixed-step loop that drives
  `record()`).
- Document the **semantic**: rewind targets to the *shooter's* render time (what the shooter saw),
  not the server's now — the part that's easy to get backwards.

## Risks & open questions

- Coupling `Rewind` to the input/render-time machinery adds a dependency; maybe the helper lives
  at the room level instead, with `Rewind` staying purely positional.
- Anti-cheat: keep the `maxRewindMs` clamp mandatory in the helper (a client spoofing a stale
  render time must not rewind arbitrarily far) — the shooter does this; the helper should enforce it.

## Acceptance criteria

- [x] A helper that, given an acting client's sessionId, yields clamped rewound target positions
      (with live fallback) without the caller storing a `renderTimes` map. → `rewind.lastSeenBy(sid)`.
- [x] The shooter's collision pass uses it and drops the manual `renderTimes` bookkeeping +
      clamp + fallback. → `BattleRoyaleRoom`, `PlatformerRoom`, and `fps-demo` all migrated.
- [x] Docs state the "rewind to the actor's render time" semantic clearly. → `PREDICTION.md` §6.

## References

- `packages/core/src/Rewind.ts` (`allowRewindState`, `attachAll`, `valueAt`, `maxRewindMs`, `record`)
- `packages/core/src/input/InputBuffer.ts` (`renderTime`)
- `demos/multiplayer-2d-shooter-prototype/server/src/rooms/BattleRoyaleRoom.ts` (`renderTimes`
  map, the manual clamp + `valueAt` + live fallback in `step()`)
- `test/prediction/src/server/PlatformerRoom.ts` (`stepCollisions` — the reference's manual
  rewind-to-renderTime, the pattern to encapsulate)
