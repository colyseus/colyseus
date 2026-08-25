/**
 * Side-effect import that monkey-patches `Room.prototype` with two
 * inspector hooks the admin's state-editor calls via `remoteRoomCall`.
 *
 * Why a patch and not a method on `Room`: the methods are only useful
 * when @colyseus/admin is mounted, and the path/key traversal is
 * inherently duck-typed (Schema arrays expose `.at(idx)`, Schema maps
 * expose `.get(key)`, plain objects use bracket access). Keeping the
 * footprint on the core class clean — and the duck typing local to
 * the consumer — is the same trade-off @colyseus/monitor made.
 *
 * Imported for its side effects only:
 *
 *   import './ext/Room.js';
 *
 * Idempotent — re-importing in a hot-reload scenario reassigns the
 * same closures, no duplicate state.
 *
 * Both methods are async so `matchMaker.remoteRoomCall` (which awaits
 * the return value) works the same in single-process and presence-
 * brokered deployments. Failures are swallowed silently here for the
 * "path missing" case — the inspector poll will reflect the unchanged
 * tree on the next refresh.
 */
import { Room } from '@colyseus/core';

/**
 * Resolve `parent[key]` accounting for the three container shapes
 * we encounter in Colyseus state trees: Schema arrays (`.at()`),
 * Schema maps (`.get()`), and plain JS objects/arrays. We prefer
 * `.at()` for numeric keys so negative indices keep working on
 * `ArraySchema`.
 */
function getChild(parent: any, key: string | number): any {
  if (parent === null || parent === undefined) { return undefined; }
  if (typeof parent.at === 'function' && typeof key === 'number') {
    return parent.at(key);
  }
  if (typeof parent.get === 'function') {
    return parent.get(String(key));
  }
  return parent[key];
}

(Room.prototype as any)._editStateProperty = async function (
  path: ReadonlyArray<string | number>,
  value: any,
): Promise<void> {
  let current: any = this.state;
  for (let i = 0; i < path.length - 1; i++) {
    if (current === null || current === undefined) { return; }
    current = getChild(current, path[i]);
  }
  if (current === null || current === undefined) { return; }
  const property = path[path.length - 1];
  if (typeof current.set === 'function') {
    current.set(String(property), value);
  } else {
    current[property as any] = value;
  }
};

(Room.prototype as any)._deleteStateProperty = async function (
  path: ReadonlyArray<string | number>,
): Promise<void> {
  let current: any = this.state;
  for (let i = 0; i < path.length - 1; i++) {
    if (current === null || current === undefined) { return; }
    current = getChild(current, path[i]);
  }
  if (current === null || current === undefined) { return; }
  const property = path[path.length - 1];
  if (typeof current.delete === 'function') {
    current.delete(String(property));
  } else {
    // For top-level Schema fields, `delete state.field` is a no-op —
    // @colyseus/schema defines fields via getters/setters, so the
    // `delete` operator can't actually remove them, and the change
    // tree never sees a deletion. Assigning `undefined` triggers the
    // field setter, which recognizes the sentinel and emits a DELETE
    // op to the encoder. Plain objects work either way; this is the
    // form that also works for Schema instances.
    current[property as any] = undefined;
  }
};
