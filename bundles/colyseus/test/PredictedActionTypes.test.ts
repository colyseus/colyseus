import assert from "assert";
import { Room, type Client, type MessageContext } from "@colyseus/core";
import { Room as SDKRoom, Predict } from "@colyseus/sdk";
import { schema, t, type SchemaType } from "@colyseus/schema";

/**
 * Compile-time assertions for `predict.action(...)` inference — the action's
 * `payload` is read from the named `messages` handler, and the `rollback`
 * `reason` from that handler's `ctx.reject(...)` returns (the verdict arms are
 * subtracted from the request-data response type). Mirrors RequestResponseTypes.
 */
describe("Predicted Actions: Type Inference", () => {
  const ArenaState = schema({ bullets: t.map(t.number()) });
  type ArenaState = SchemaType<typeof ArenaState>;
  const Bullet = schema({ x: t.number(), y: t.number() }, "AT_Bullet");
  type Bullet = SchemaType<typeof Bullet>;

  class ArenaRoom extends Room<{ state: ArenaState }> {
    state = new ArenaState();

    messages = {
      fire: (_client: Client, payload: { x: number; y: number }, ctx: MessageContext) => {
        if (payload.x < 0) { return ctx.reject("offmap" as const); }     // Rejection<"offmap">
        if (payload.y < 0) { return ctx.reject("cooldown" as const); }   // Rejection<"cooldown">
        const bullet = new Bullet();
        return ctx.resolve(bullet);                                      // Resolution<Bullet>
      },
      emote: (_client: Client, _payload: { kind: string }) => { /* effect-less, no verdict */ },
    };
  }

  // type-only: never invoked at runtime
  function _assertActionTyping(room: SDKRoom<ArenaRoom>, predict: Predict) {
    const fire = predict.action(room, "fire", {
      predict: (p) => {
        const x: number = p.x;        // payload inferred from messages.fire
        const y: number = p.y;
        void x; void y;
        return { localId: 1 };        // H inferred from this return
      },
      rollback: (handle, reason) => {
        const id: number = handle.localId;             // H flows into rollback
        const r: "offmap" | "cooldown" = reason;       // reason = ExtractRejectReason
        void id; void r;
      },
    });
    fire({ x: 1, y: 2 });             // returned fire is (payload) => void

    // @ts-expect-error - wrong payload shape for "fire"
    fire({ x: "nope", y: 2 });

    // effect-less action: predict may return void, rollback optional
    const emote = predict.action(room, "emote", { predict: () => {} });
    emote({ kind: "wave" });

    // @ts-expect-error - "unknown" is not a declared message/action type
    predict.action(room, "unknown", { predict: () => {} });

    // rollback is optional (default is handle.cancel())
    predict.action(room, "fire", { predict: () => ({ localId: 2 }) });
  }

  it("predict.action types compile correctly", () => {
    assert.ok(typeof _assertActionTyping === "function");
  });
});
