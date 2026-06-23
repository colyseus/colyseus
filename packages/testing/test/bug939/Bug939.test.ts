import assert from "assert";
import { boot, ColyseusTestServer } from "../../src/index.ts";

import appConfig from "./app.config.ts";
import { EXPECTED_FLOAT_PAYLOAD } from "./Bug939Room.ts";

describe("colyseus/colyseus#939 (msgpackr useBuffer/targetView)", () => {
  let colyseus: ColyseusTestServer;

  before(async () => colyseus = await boot(appConfig, 2569));
  after(async () => colyseus.shutdown());

  it("float64 fields must survive a >8KB binary broadcast", async () => {
    const client = await colyseus.sdk.joinOrCreate("bug939");

    const payloads: any[] = [];
    client.onMessage("payload", (msg) => payloads.push(msg));
    client.onMessage("blob", () => {/* ignore raw bytes */});

    client.send("go");

    // wait for both "payload" messages to arrive
    await new Promise((resolve) => setTimeout(resolve, 300));

    console.log("expected:", EXPECTED_FLOAT_PAYLOAD);
    console.log("payload BEFORE big binary broadcast:", payloads[0]);
    console.log("payload AFTER  big binary broadcast:", payloads[1]);

    assert.deepStrictEqual(payloads[0], EXPECTED_FLOAT_PAYLOAD, "baseline payload should be intact");
    assert.deepStrictEqual(payloads[1], EXPECTED_FLOAT_PAYLOAD, "payload after binary broadcast should be intact");
  });
});
