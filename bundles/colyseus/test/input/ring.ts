import { InputEncoder } from "@colyseus/schema/input";
import { Protocol } from "@colyseus/core";

/**
 * Successive `ROOM_INPUT_UNRELIABLE` packets from a SINGLE encoder, so the
 * framework wire seq (which drives ring dedupe — NOT a user `seqField`) stays
 * continuous across packets, exactly as a real client's redundancy ring slides.
 *
 * Each returned `tick(mutator)` stages one input and returns the packet that
 * client would have sent that frame, carrying the last `historySize` slots.
 * Delivering those packets by hand is what makes loss, reordering and
 * duplication exact in a test rather than hoped for.
 */
export function unreliableRing<I extends object>(Ctor: new () => I, historySize: number) {
  const inst = new Ctor();
  const encoder = new InputEncoder(inst as any, { mode: "unreliable", historySize });
  return (mutator: (inst: I) => void): Uint8Array => {
    mutator(inst);
    return frame(encoder.encode());
  };
}

/**
 * One `ROOM_INPUT_UNRELIABLE` packet built from `mutators` — the ring of every
 * snapshot staged so far, in a single call. Use {@link unreliableRing} when the
 * test needs the intermediate packets too.
 */
export function unreliableRingPacket<I extends object>(
  Ctor: new () => I,
  mutators: Array<(inst: I) => void>,
): Uint8Array {
  const inst = new Ctor();
  const encoder = new InputEncoder(inst as any, { mode: "unreliable", historySize: mutators.length });
  let last: Uint8Array = new Uint8Array(0);
  for (const m of mutators) { m(inst); last = encoder.encode(); }
  return frame(last);
}

function frame(body: Uint8Array): Uint8Array {
  const framed = new Uint8Array(1 + body.length);
  framed[0] = Protocol.ROOM_INPUT_UNRELIABLE;
  framed.set(body, 1);
  return framed;
}
