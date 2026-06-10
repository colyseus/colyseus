# 13 — Room-level idle policy (`defineInput({ idle })`)

> `drain/next({ idle })` unified the consume loop, but the idle SHAPE is still
> declared at every call site. The policy is a per-room constant — declare it
> once at `defineInput`, where `bufferMaxSize`/`renderTime` already live.

- **Status:** Done (2026-06-10)
- **Priority:** P2
- **Area:** `packages/core` (input layer) + reference-room migrations
- **Surfaced by:** fps-demo's per-tick inline idle callback after the `{ idle }` migration

## Key insight

Everything the call site supplies is reachable from a room-scoped callback:
- the game entity → `this.state.players.get(sessionId)` (lazy — empty ticks only)
- the tick `dt` → `this.clock.deltaTime` (inside `setTimestep`'s tick this IS the
  callback's `dtMs`) or `input.stepSeconds` for fixed-step rooms
- liveness → `this.clients.getById(sessionId)?.state === ClientState.JOINED`
  (userland — what counts as "still here" is a game decision, e.g. how to treat
  RECONNECTING; the ctx deliberately does NOT pre-compute it)

So nothing structurally forces the idle shape to the call site.

## Decided design

1. **`defineInput(Input, { ..., idle })`** — room-level absence policy.
2. **Bare `drain()`/`next()` apply it automatically.** Declaring `idle` IS the
   opt-in; skip-policy rooms (platformer) simply don't declare it. Per-call
   `{ idle }` overrides (full replacement, no merging); `{ idle: false }`
   force-skips.
3. **Unified callback signature** for both levels (replaces the shipped
   `(latest) => …` form — unreleased, just update call sites/tests):
   ```ts
   interface IdleContext<I> {
     latest: I | undefined;  // last decoded input (undefined before the first)
     sessionId: string;
   }
   type IdleInput<I> = true | Partial<I> | ((ctx: IdleContext<I>) => true | Partial<I>);
   ```
   `ctx` is a reused per-buffer scratch (read it inside the callback, don't
   store). It carries MECHANISM only — derived judgments like liveness stay in
   userland (same rationale as rejecting `.hold()`).
4. **Conditional typing** (keep only if readable): `defineInput` captures its opts
   generically so the returned `InputAPI`'s accessor types `next(): I` (no
   `undefined`) when `idle` was declared. Variance is fine — the narrowed
   accessor is assignable to the base `InputAccessor<I>`. Fallback: drop the
   generic, callers use `!`.

## Target call sites

```ts
// fps-demo — policy at defineInput, call site bare:
input = this.defineInput(MoveInput, {
  bufferMaxSize: 64, renderTime: true,
  idle: ({ latest: last, sessionId }) => {
    const p = this.state.players.get(sessionId);
    if (!p) return true;
    // Held intents persist only while the client is still connected — a drop
    // must never auto-complete a plant/defuse or keep a grenade cooking.
    const live = this.clients.getById(sessionId)?.state === ClientState.JOINED;
    const cookingNade = isGrenade(weaponFromIndex(this.heldWeaponId(p)));
    return {
      slot: p.currentSlot, nadeSel: NO_WEAPON, yaw: p.yaw, pitch: p.pitch,
      dt: this.clock.deltaTime / 1000,
      plant: live && !!last?.plant, use: live && !!last?.use,
      fire: cookingNade && live && !!last?.fire, scoped: cookingNade && live && !!last?.scoped,
    };
  },
});
for (const f of inputCh.drain()) { ... }          // zero idle noise

// battleroyale — hold-everything while connected:
input = this.defineInput(InputSchema, {
  bufferMaxSize: 64, renderTime: true,
  idle: ({ latest, sessionId }) =>
    (this.clients.getById(sessionId)?.state === ClientState.JOINED && latest) || true,
});
const inp = this.input(sessionId).next();          // typed I (conditional typing)
```

Side benefit: the per-player-per-tick closure allocation at every call site
disappears — the policy closure is created once at `defineInput`.

## Implementation notes

- `InputOptions.idle` stores the policy; `InputBufferImpl` receives the CLIENT
  ref (replacing the `latest`-provider closure — it derives `latest` and
  `sessionId` from it; `ClientPrivate` is already imported there) plus the
  room-level policy at construction (defineInput runs before any join — order is
  safe).
- Resolution order in drain/next: per-call `idle === false` → skip; per-call
  `idle` set → use it; else room-level set → use it; else skip ([] / undefined).
- Invariants carried over unchanged: synthesis never advances `consumedCount` /
  `renderTime`; one reused idle frame per client; field-name copy (schema
  instances work as overrides; `{ ...latest }` spread copies nothing); real
  frames always win; no synthesis for NO_OP/unknown sids or `bufferMaxSize: 0`.
- Rejected alternatives (for the record): two-level merge (room policy + per-call
  extras) — splits one policy across two places; per-client `setIdle()` at onJoin —
  per-client config for a room constant + reconnect lifecycle questions;
  framework-driven `onInput` consumption — inverts loop ownership.

## Acceptance criteria

- [x] `defineInput({ idle })` declared once; bare `drain()`/`next()` synthesize.
- [x] Per-call `{ idle }` overrides; `{ idle: false }` suppresses.
- [x] Both callback levels receive `IdleContext` (`latest` + `sessionId`;
      liveness stays a userland lookup inside the callback).
- [x] fps/battleroyale call sites are bare; platformer untouched (skip by default).
- [x] `next()` types non-optional when `idle` is declared — via
      `defineInput<C, O>` capturing the opts and `IdleDeclared<O, I>` narrowing
      `InputAPI<I, Idle>`/`InputAccessor<I, Idle>` (proved by battleroyale
      compiling `inp.angle` on a bare `next()`).
- [x] Tests: auto-apply, override, suppress, ctx.sessionId/latest delivery, lazy
      invocation, ack/renderTime invariants re-asserted through the room-level path
      (12 in `bundles/colyseus/test/input/InputIdle.test.ts`).
- [x] PREDICTION.md "Empty ticks" section shows the room-level form first.
