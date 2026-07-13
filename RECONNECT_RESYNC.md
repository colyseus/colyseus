# Reconnect resync — plan

Fix two confirmed bug classes that hit every client that drops and reconnects
mid-room (auto-reconnect or `allowReconnection` reclaim). Investigated and
verified empirically against `demos/moba` on 2026-07-10..13; every claim below
was tested, none is speculation.

## The two bugs

**1. Ghost entities.** DELETE ops that happen while a client is offline are
never replayed. The rejoin `ROOM_STATE` is a full snapshot (carries no
deletes), and the SDK decodes it *additively* — so everything deleted during
the outage survives client-side forever: zombie creeps frozen mid-lane with
stuck HP bars, projectiles hovering in the air, phantom drops/runes/wards,
enemy heroes frozen at their last seen position. Repro: 6s offline mid-match →
2+ zombie creeps, every run.

**2. Decode corruption ("field not defined at {index: N}" + "definition
mismatch" console spam).** The encoder *recycles* refIds. Its safety contract
(RefIdAllocator doc comment) is "the DELETE for the old instance reaches the
wire before the refId is handed to a new one" — void for a client that was off
the wire. After reconnect the client still holds the old instance at refId R
(bug 1); the server hands R to a new entity; the decoder binds ADDs **by refId
alone**, so the stale instance is adopted as the new entity:

- cross-type (stale Projectile adopted as a Creep): field indexes miss the
  stale metadata → the console spam, re-fired by every patch touching that
  ref, forever;
- same-type: **silent** — one JS instance bound to two logical entities
  (verified: `projectiles:4295` rebound as `projectiles:4380`), plus listener
  bleed: client callbacks are keyed by refId, so `listen()` handlers
  registered on the dead entity fire for the unrelated new one.

Repro: `room.connection.close(4010)` (exactly what the SDK debug panel's
"Drop" button does), reconnect, play on. Silent collision within ~25s on the
first drop; cross-type + console spam within 5s on a second drop. No latency
sim, no debug panel needed — the panel is only a convenient trigger.

## Root-cause chain (file:line, verified)

1. Server side is **already correct**: the rejoin full state is view-attached
   and complete. `allowReconnection`'s internal `.then` restores `client.view`
   (`packages/core/src/Room.ts:1852`) when the deferred resolves in `_onJoin`
   (`:1639`) — strictly before the JOIN handshake is sent (`:1760`) and the
   JOIN-ack `sendFullState` (`:2146`); `getFullState(client)` then takes the
   `encodeAllView` branch (`packages/core/src/serializer/SchemaSerializer.ts:122`).
   Wire-verified: rejoin ROOM_STATE contained creep ADDs (view-filtered ⇒
   impossible viewless).
2. SDK decodes that snapshot like a patch: `setState` = `decoder.decode`
   (`packages/sdk/src/serializer/SchemaSerializer.ts:30-32`). Purely additive.
   No reconciliation. (The decoder itself survives reconnect — the SDK sends
   `skipHandshake`, so callbacks stay wired; that part is fine.)
3. `RefIdAllocator` recycles freed ids via a free pool
   (`schema src/encoder/RefIdAllocator.ts` — the schema checkout is
   `node_modules/@colyseus/schema` → git `colyseus/schema` branch `5.0`).
4. `decodeValue` binds Schema ADDs by refId with no type/liveness check:
   `value = $root.refs.get(refId); if (!value) create`
   (`schema src/decoder/DecodeOperation.ts:134-152`).
5. `DEFINITION_MISMATCH` recovery is a heuristic byte-scan
   (`skipCurrentStructure`, `schema src/decoder/Decoder.ts:91-95,115-130`) —
   drops that ref's ops each patch; the game limps with a permanently glitched
   entity instead of crashing.

## The fix — restore two invariants (no new machinery)

Rejected alternatives, for the record: an `instanceof childType` guard on ADD
(same-type collisions still alias + listener bleed); key-based rebind with a
shadow decode + callback migration (correct but heavy — it compensates for
untrustworthy refIds instead of making them trustworthy); client discards
state on rejoin (breaks instance identity + every registered callback).

### Invariant 1 — refIds never lie: monotonic allocation

`schema src/encoder/RefIdAllocator.ts`: `acquire()` stops popping the free
pool (make `release()`/`flushReleases()`/`reclaim()`/`isPooled()` no-ops or
delete them and their call sites — the one-tick defer and resurrection logic
exist *only* to make recycling safe). Safer rollout: keep recycling behind an
opt-in flag, default off.

- **Not a wire-format change.** RefIds are varints; old/new peers interop.
  Ship without a protocol rev.
- Kills the corruption class at the source; makes refId a true identity.
- Cost: `SWITCH_TO_STRUCTURE` ids reach 2 bytes past id 16,384 (~20 min of
  moba churn), 3 bytes past ~2M (~30 h). Verified no structural blocker:
  StateView membership bitmaps are **slot-indexed per ChangeTree**, not
  refId-indexed (`src/encoder/StateView.ts:24-38`); `Root.changeTrees` is a
  numeric-keyed object with entries deleted on release (`src/encoder/Root.ts:38,199`).
- If wire bytes ever matter for week-long rooms: generation byte on entity
  ADD ops (cheaper than fat ids — ADDs are rare vs switches). That IS a
  format change → separate protocol-rev'd follow-up, not this fix.

### Invariant 2 — the full state is complete: resync sweep

`schema src/decoder/Decoder.ts` + `DecodeOperation.ts`: a resync mode on the
decoder (`decoder.decode(bytes, it, changes, { resync: true })` or a dedicated
`decodeResync`). During the decode walk, record visited (collectionRef, index)
pairs — the decoder sees every op including no-op re-ADDs (note:
`allChanges` does NOT — changes are only pushed when `previousValue !== value`,
`DecodeOperation.ts:264` — which is why the sweep must live inside the walk).
After the loop, walk all collections reachable from the root; entries not
visited go through the **existing** DELETE path: DataChange DELETE (fires
`onRemove` with real previousValue via `triggerChanges`), `$deleteByIndex`,
`removeRef` → `garbageCollectDeletedRefs`. ~50-100 lines; the mode flag costs
nothing on the normal path.

With Invariant 1 in place, the existing refId-reuse decode path IS the
identity mechanism, already proven correct: a surviving entity re-decodes onto
the same instance (fields rewritten, no `onAdd` re-fire — the
`previousValue !== value` guard — callbacks intact). The sweep only removes
what the snapshot doesn't mention, which with a view-attached encode is
exactly "dead or out of your view" — both correct removals (fog semantics).
Bonus: an entity re-keyed during the outage (moba's bot re-key) survives as
the same instance under the new key (one onAdd + one onRemove).

### SDK trigger

`packages/sdk/src/Room.ts`: the rejoin branch (the one that fires
`onReconnect`, `:610-614`) sets a `needsResync` flag; the `ROOM_STATE` handler
(`:640`) passes it to `setState`. (Unconditional resync also works — first
join sweeps an empty state — but the flag keeps first-join on the untouched
fast path.) Optionally add `room.onResync`, fired after the resync decode —
`onReconnect` fires *before* ROOM_STATE, so games have no "state is
authoritative again" edge today.

## Implementation order

1. **schema: monotonic refIds** (+ unit tests). Land-alone; kills corruption.
2. **schema: resync sweep** (+ unit tests). Kills ghosts.
3. **sdk: resync trigger + `onResync`**.
4. **demo (`demos/moba`)**: promote the probes to a real smoke
   (`smoke-reconnect-bots`, see Validation); fix the stale comment in
   `MobaRoom.onDrop` ("the fresh JOIN state was encoded viewless" — false for
   reconnect since the view is restored before the JOIN ack; still true for
   the class-pick/takeover path, so `pendingBootstrap` stays for those).
5. **core (later, ergonomics)**: auto full-resync when `client.view` is
   (re)attached — would obsolete the demo's `bootstrapClientView` /
   `pendingBootstrap` / `dropBacklogIfDormant` entirely.
6. **later, optimization**: per-view patch-journal resume (patch seq + ring
   buffer, replay missed deltas, fall back to full resync past the window).
   Not correctness — don't block on it. Note state resync does NOT recover
   one-shot messages missed while offline (killfeed/gold EVTs) — separate
   concern, same journal family.

Build/dev loop: schema checkout builds with `npm run build` (tsc + rollup;
demo consumes `build/index.mjs`), tests with `npm test` (mocha). After schema
edits: rebuild, then restart the demo's `pnpm dev` (vite prebundle +
hot-restored rooms).

## Edge cases the sweep must cover (test matrix)

- MapSchema of Schema (heroes/creeps) — the main path.
- MapSchema of primitives (moba `trees` exceptions) — prune by key, no child ref.
- Nested collections (hero.items ArraySchema) — recurse; retained parent,
  swept children.
- ArraySchema — visited by index; trim tail with per-index onRemove. Arrays
  have no stable keys; identity by index is the documented best-effort.
- Collection absent from the encode entirely (server emptied it) — must still
  be swept (walk ALL reachable collections, not just visited refs).
- Refcount: no double-decrement (reuse existing GC; see the DELETE_BY_REFID
  refId-leak fix `352795f` for the hazard class).
- Late DELETE race: a patch encoded the same tick as the snapshot may DELETE
  an entry the sweep already removed — existing `previousValue === undefined`
  guard skips it (`Callbacks.ts:398-411`); add a test pinning that.
- StreamSchema fields: trickled entries enter `view.items` via
  `_emitStreamPriority`, so they ARE in the full encode → retained. Pin with
  a test.
- Regression for bug 2 even with monotonic ids: construct a stale ref
  manually (decode, then decode a full state where that refId now names a
  different-type instance) and assert the sweep + fresh-bind produces no
  metadata mismatch. (With recycling off this can't arise on the wire; the
  test documents the invariant.)

## Validation

Already-written artifacts (in `demos/moba/scripts/`, all take a port arg;
`pnpm dev` first; each needs `?create=1&bots=1` isolation which they set up
themselves):

- `proto-schema-resync.mjs` — pure schema-level prototype of the sweep
  semantics (shadow-decode variant). Green today; seed for schema unit tests.
- `probe-reconnect-ghosts.mjs` — joins, drops offline 6s, reconnects; counts
  creeps frozen over 3s (ghosts) + stale projectiles + decode errors + walks
  the hero. Today: 2+ frozen creeps. Green = 0 frozen, 0 errors.
- `probe-reconnect-collision.mjs` — tags every instance with its first
  (collection,key) binding, drops via `connection.close(4010)` twice, scans
  for SHARED/REBOUND identities + counts "field not defined"/"definition
  mismatch". Today: collisions within 5-25s, 19 errors/min after drop 2.
  Green = 0 conflicts, 0 errors across both drops.
- `probe-reconnect-wire.mjs` — instruments the client serializer to classify
  what the rejoin ROOM_STATE and first patches contain (used to prove the
  snapshot is view-attached). Diagnostic, not pass/fail.

Promote ghosts+collision into `smoke-reconnect-bots.mjs` with the repo's
`OK:`/`FAIL:` contract once the fix lands. Also rerun the existing
`smoke-reconnect.mjs` (no-bots frozen-reconciler case) and the demo's full
smoke suite for regressions; schema `npm test` + the `bench:gate` perf gate
(first-join decode must not regress).

## Facts already verified — do NOT re-derive

- Rejoin full state is view-attached (see chain #1). The moba comment saying
  otherwise is stale for the reconnect path.
- Decoder + callbacks survive reconnect (`skipHandshake`; `Callbacks.get`
  binds `serializer.decoder`, which is only replaced when a handshake is
  re-sent — `packages/sdk/src/serializer/SchemaSerializer.ts:46-60`).
- Instance identity across a full re-decode works (same instance, updated
  fields, no onAdd re-fire) — `proto-schema-resync.mjs` proves it.
- Client callbacks are keyed by refId on `decoder.root.callbacks`
  (`schema src/decoder/strategy/Callbacks.ts:58-72`) — why monotonic ids make
  callback migration unnecessary.
- StateView bitmaps are slot-indexed, not refId-indexed → no memory blowup
  from monotonic ids.
- The SDK debug panel is exonerated: its Drop = `connection.close(4010)`
  (`packages/sdk/src/debug/panel.ts:199`); latency sim preserves ordering and
  delays onclose past pending delayed messages (`debug.ts:220-233`). One real
  nit: the onclose delay is skipped for jitter-only sim (delay=0, jitter>0) —
  harmless in practice (reconnect latency >> jitter), one-line fix while
  in there.
- Unrelated known issue, same territory (fixed earlier in this checkout):
  DELETE_BY_REFID refId leak, commit `352795f`.

## Related demo-side issue (separate, not this plan)

A drop longer than the 15s grace: seat expires, SDK burns 15 retries (~70s)
against `524 seat reservation expired`, then `onLeave(4003)` — the moba client
registers no onLeave/onError handler and has no reconnecting/disconnected UI,
so the game freezes silently. Demo fix: handler + overlay. SDK nice-to-have:
treat 524 as fatal instead of retrying.
