/**
 * Declarative confirm binding for predicted event channels — the `confirmOn`
 * option of `predict.defineEvent`.
 *
 * Most channels confirm from the same authoritative signal shape: "this
 * collection entry's field flipped" (a crate's `alive`, a box's `active`), or
 * the collection membership change IS the signal (a banana appearing /
 * disappearing). `confirmOn` absorbs that wiring: the owning Predict
 * subscribes the schema listeners and calls `channel.confirm(...)` on the
 * channel's behalf, tearing them down with the channel.
 *
 * Three variants, all **data** (a collection name, a field name, an expected
 * value) — deliberately no predicate closures, so the binding serializes and
 * ports to non-JS clients as a plain struct:
 *
 *     confirmOn: { collection: "crates",  field: "alive", equals: false }
 *     confirmOn: { collection: "bananas", event: "remove" }
 *     confirmOn: { collection: "bananas", event: "add", mine: "owner" }
 *
 *   - **field-flip** — when a child's `field` becomes `equals`, confirm the
 *     entry keyed by that child's COLLECTION key. Requires channel entry keys
 *     (the `uniqueBy` output) to BE collection keys; mismatched schemes stay
 *     manual.
 *   - **`event: "remove"`** — the child's removal confirms the entry keyed by
 *     the removed key.
 *   - **`event: "add"`** — a child's arrival confirms KEYLESS (settle-all): a
 *     predicted spawn/drop can't know the key the server will assign, so these
 *     channels hold a single anonymous pending slot. `mine` names a child
 *     field compared `===` to the room's `sessionId`, so a remote player's
 *     add doesn't falsely confirm ours.
 *
 * Root-level collections only. Rejects are never auto-bound — the ack-anchored
 * auto-reject already covers the miss case, and a wrong binding producing
 * silent rejects would be hard to debug. Confirm-only.
 */

import type { CollectionKeys, ChildOf } from "../core/schema-reflect.ts";

/** The loose callbacks surface the owning Predict already holds (its
 *  `Callbacks.get(room)` wrapper). All three return detach functions. */
export interface ConfirmOnCallbacks {
    onAdd: (...args: any[]) => () => void;
    onRemove: (...args: any[]) => () => void;
    listen: (instance: any, field: string, cb: (v: any) => void, immediate?: boolean) => () => void;
}

// Two flat shapes discriminated on the PRESENCE of `field` vs `event` (the
// absent members typed `?: undefined`) — presence checks narrow reliably
// where boolean discriminants don't. Distributed over the state's collection
// keys so `field`/`mine` complete to the child's own fields.
type ConfirmOnField<TState> = {
    [K in CollectionKeys<TState> & keyof TState]: {
        /** Root-level collection whose children carry the signal field. */
        collection: K;
        /** Confirm `channel.confirm(collectionKey)` when this child field
         *  becomes {@link equals}. */
        field: keyof ChildOf<TState[K]> & string;
        equals: string | number | boolean;
        event?: undefined;
        mine?: undefined;
    }
}[CollectionKeys<TState> & keyof TState];

type ConfirmOnSignal<TState> = {
    [K in CollectionKeys<TState> & keyof TState]: {
        /** Root-level collection whose membership change is the signal. */
        collection: K;
        /** `remove` confirms keyed by the removed collection key; `add`
         *  confirms KEYLESS (settle-all — a predicted spawn can't know its
         *  server key), optionally gated by {@link mine}. */
        event: "add" | "remove";
        /** `add` only: child field compared `===` to the room's `sessionId`
         *  (requires a Predict built from a Room). */
        mine?: keyof ChildOf<TState[K]> & string;
        field?: undefined;
        equals?: undefined;
    }
}[CollectionKeys<TState> & keyof TState];

export type ConfirmOn<TState = any> = ConfirmOnField<TState> | ConfirmOnSignal<TState>;

/** Runtime shape of {@link ConfirmOn} — what the wiring actually reads. */
export interface ConfirmOnResolved {
    collection: string;
    field?: string;
    equals?: unknown;
    event?: "add" | "remove";
    mine?: string;
}

/**
 * Subscribe the schema listeners for a {@link ConfirmOn} binding and route
 * them into `channel.confirm(...)`. Returns a single idempotent detacher
 * (registered on the channel's teardown list by `defineEvent`).
 */
export function wireConfirmOn(
    callbacks: ConfirmOnCallbacks,
    channel: { confirm(key?: string | number): number },
    on: ConfirmOnResolved,
    sessionId: (() => string | undefined) | undefined,
): () => void {
    const offs: Array<(() => void) | undefined> = [];

    if (on.field !== undefined) {
        // field-flip: per-child listeners, wired as children arrive (onAdd
        // replays existing children by default — wanted here).
        const listeners = new Map<object, () => void>();
        offs.push(callbacks.onAdd(on.collection, (child: object, key: string | number) => {
            if (listeners.has(child)) return;   // decoder can re-fire onAdd for one ref
            listeners.set(child, callbacks.listen(
                child,
                on.field!,
                (v: unknown) => { if (v === on.equals) channel.confirm(key); },
                // no immediate fire: a child already flipped at bind time is
                // history, not a settle signal (would fire onUnpredicted)
                false,
            ));
        }));
        offs.push(callbacks.onRemove(on.collection, (child: object) => {
            listeners.get(child)?.();
            listeners.delete(child);
        }));
        offs.push(() => {
            for (const off of listeners.values()) off();
            listeners.clear();
        });
    } else if (on.event === "remove") {
        offs.push(callbacks.onRemove(on.collection, (_child: object, key: string | number) => {
            channel.confirm(key);
        }));
    } else {
        // add: keyless settle-all, optionally only for our own entities.
        // No replay of existing entries — they're history, not signals.
        offs.push(callbacks.onAdd(on.collection, (child: Record<string, unknown>) => {
            if (on.mine !== undefined && child[on.mine] !== sessionId?.()) return;
            channel.confirm();
        }, false));
    }

    return () => {
        for (const off of offs.splice(0)) off?.();
    };
}
