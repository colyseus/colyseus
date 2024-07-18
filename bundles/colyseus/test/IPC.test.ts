import assert from "assert";

import { PRESENCE_IMPLEMENTATIONS } from "./utils";
import { subscribeIPC, requestFromIPC } from "@colyseus/core";
import { ServerError } from "@colyseus/core";

describe("Inter-process Communication", () => {
  for (let i = 0; i < PRESENCE_IMPLEMENTATIONS.length; i++) {
    const presence = new PRESENCE_IMPLEMENTATIONS[i]();

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

      it("IPC timeout error should be thrown", async () => {
        try {
          await requestFromIPC(presence, "nonexisting", "nonexisting", [])
          throw new Error("should have errored.");
        } catch (e) {
          assert.strictEqual(e.message, "ipc_timeout");
        }
      });

      it("should reject with error message", async () => {
        const channel = 'error-channel';

        subscribeIPC(presence, "anything", channel, (method, args) => {
          throw new Error("error message");
        });

        try {
          await requestFromIPC(presence, channel, "anything", []);
          assert.fail("should have errored.");

        } catch (e) {
          assert.ok(e instanceof Error);
          assert.strictEqual(e.message, "error message");
        }
      });

      it("should reject with plain error string", async () => {
        const channel = 'error-channel';

        subscribeIPC(presence, "anything", channel, (method, args) => {
          throw "error message";
        });

        try {
          await requestFromIPC(presence, channel, "anything", []);
          assert.fail("should have errored.");

        } catch (e) {
          assert.ok(e instanceof Error);
          assert.strictEqual(e.message, "error message");
        }
      });

      it("ServerError: should reject containing error code", async () => {
        const channel = 'error-code';

        subscribeIPC(presence, "anything", channel, (method, args) => {
          throw new ServerError(1000, "error message");
        });

        try {
          await requestFromIPC(presence, channel, "anything", []);
          assert.fail("should have errored.");

        } catch (e) {
          assert.strictEqual(e.message, "error message");
          assert.strictEqual(e.code, 1000);
          // assert.ok(e instanceof Error);
        }
      });

    });
  }
});