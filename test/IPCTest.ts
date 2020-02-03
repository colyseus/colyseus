import assert from "assert";

import { PRESENCE_IMPLEMENTATIONS } from "./utils";
import { subscribeIPC, requestFromIPC } from "../src/IPC";

describe("Inter-process Communication", () => {
  for (let i = 0; i < PRESENCE_IMPLEMENTATIONS.length; i++) {
    const presence = PRESENCE_IMPLEMENTATIONS[i];

    describe(`Using presence: ${presence.constructor.name}`, () => {

      it("#subscribeIPC / #publishIPC", async () => {
        await subscribeIPC(presence, "process-one", "channel", (method, args) => {
          assert.equal("methodName", method);
          assert.deepEqual(["one", 2, { boolean: true }], args);
          return new Promise((resolve) => {
            setTimeout(() => resolve(["two", 3, { boolean: true }]), 100);
          });
        });

        await assert.doesNotReject(async () => {
          const response = await requestFromIPC(presence, "channel", "methodName", ["one", 2, { boolean: true }]);
          assert.deepEqual(["two", 3, { boolean: true }], response);
        });

      });

      it("#publishIPC should allow 'undefined' methodName", async () => {
        const channel = 'test-channel';

        subscribeIPC(presence, "public-ipc-test", channel, (method, args) => {
          assert.equal(undefined, method);
          assert.deepEqual([true], args);
          return "hello!"
        });

        await assert.doesNotReject(async () => {
          const response = await requestFromIPC(presence, channel, undefined, [true]);
          assert.equal("hello!", response);
        });
      });

    });
  }
});