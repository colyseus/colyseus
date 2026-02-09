import assert from "assert";
import { ColyseusSDK } from "@colyseus/sdk";

import { defineServer, defineRoom, matchMaker, LocalDriver } from "@colyseus/core";
import { uWebSocketsTransport } from "@colyseus/uwebsockets-transport";

import { auth } from "@colyseus/auth";
import { DummyRoom } from "./utils/index.ts";
import { WebSocketTransport } from "@colyseus/ws-transport";

const TEST_PORT = 8567;
const TEST_ENDPOINT = `ws://localhost:${TEST_PORT}`;

const transports = [
  WebSocketTransport,
  uWebSocketsTransport,
];

transports.forEach((transport) => {
  describe(`Auth Integration: ${transport.constructor.name}`, () => {
    /**
     * Auth Module Setup
     * -----------------
     */
    const fakeDb: any[] = [];
    auth.settings.onFindUserByEmail = async (email) => {
      const userFound = fakeDb.find((user) => user.email === email);;
      console.log("onFindUserByEmail", userFound);
      // return a copy of the user object
      return userFound && JSON.parse(JSON.stringify(userFound));
    };

    auth.settings.onRegisterWithEmailAndPassword = async (email, password) => {
      const user = { email, password, name: email.split("@")[0], errorServerIsStringButClientIsInt: "this should not crash the client", someAdditionalData: true, };
      fakeDb.push(JSON.parse(JSON.stringify(user))); // keep a copy of the user object
      return user;
    };

    auth.settings.onRegisterAnonymously = async (options) => ({
      anonymousId: Math.round(Math.random() * 1000), anonymous: true, ...options
    });

    let server: ReturnType<typeof defineServer>;
    let driver = new LocalDriver();
    const client = new ColyseusSDK(TEST_ENDPOINT);

    before(async () => {
      process.env.JWT_SECRET = "test";

      server = defineServer({
        driver,
        greet: false,
        transport: new transport(),
        rooms: {
          dummy: defineRoom(DummyRoom),
        },
        express: (app) => {
          app.use(auth.prefix, auth.routes());
        }
      });

      await server.listen(TEST_PORT);
    });

    beforeEach(async() => {
      await matchMaker.stats.reset();
      await driver.clear()
    });

    after(async () => {
      await driver.clear();
      await server.gracefullyShutdown(false);
    });

    describe("anonymous", () => {
      it("should allow to sign-in as 'anonymous'", async () => {
        const signIn = await client.auth.signInAnonymously();
        assert.ok(signIn.user);
        assert.ok(signIn.user.anonymous);
        assert.ok(signIn.token);
      });
    });

  });
});
