import { Room, type Client } from "@colyseus/core";

const FLOAT_PAYLOAD = { x: 3.14159, y: -2.5, ts: 1747900000000 };

export class Bug939Room extends Room {
  maxClients = 1;

  messages = {
    // Reproduces colyseus/colyseus#939 end-to-end:
    "go": (client: Client) => {
      // 1) baseline: object message with float64 fields, fresh 8KB packr buffer
      this.broadcast("payload", { ...FLOAT_PAYLOAD });

      // 2) binary broadcast larger than the 8KB packr buffer -> getMessageBytes.raw
      //    rawMessage branch calls packr.useBuffer(Buffer.alloc(bigger)), which (in the
      //    buggy @colyseus/msgpackr) swaps `target` but leaves `targetView` stale.
      this.broadcast("blob", new Uint8Array(9000));

      // 3) same float64 object message again -> now packed via the stale targetView
      this.broadcast("payload", { ...FLOAT_PAYLOAD });
    },
  };
}

export const EXPECTED_FLOAT_PAYLOAD = FLOAT_PAYLOAD;
