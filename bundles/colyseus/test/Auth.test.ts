import assert from "assert";
import { ColyseusSDK } from "@colyseus/sdk";

import { defineServer, defineRoom, definePlugins, matchMaker, LocalDriver, Room, RoomPlugin, ServerError } from "@colyseus/core";
import { uWebSocketsTransport } from "@colyseus/uwebsockets-transport";

import { auth, JWT } from "@colyseus/auth";
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

    describe("instance-level onAuth with a valid token", () => {
      beforeEach(async () => { client.auth.token = await JWT.sign({ id: "u1" }); });
      afterEach(() => client.auth.signOut());

      it("still runs, and can reject the join", async () => {
        matchMaker.defineRoomType('instance_auth', class extends Room {
          onAuth() { throw new ServerError(400, "Invalid token"); }
        });

        await assert.rejects(client.joinOrCreate('instance_auth'), /Invalid token/);
      });

      it("its return value becomes client.auth", async () => {
        matchMaker.defineRoomType('instance_auth', class extends Room {
          onAuth() { return { role: "admin" }; }
        });

        const sdkRoom = await client.joinOrCreate('instance_auth');
        const room = matchMaker.getLocalRoomById(sdkRoom.roomId);
        assert.deepStrictEqual(room.clients[0].auth, { role: "admin" });
        await sdkRoom.leave();
      });

      it("returning `true` keeps the decoded token payload", async () => {
        matchMaker.defineRoomType('instance_auth', class extends Room {
          onAuth() { return true; }
        });

        const sdkRoom = await client.joinOrCreate('instance_auth');
        const room = matchMaker.getLocalRoomById(sdkRoom.roomId);
        assert.strictEqual(room.clients[0].auth.id, "u1");
        await sdkRoom.leave();
      });

      it("plugin onAuth hooks still run", async () => {
        class Guard extends RoomPlugin {
          onAuth() { throw new ServerError(403, "blocked by plugin"); }
        }
        matchMaker.defineRoomType('instance_auth', class extends Room {
          plugins = definePlugins({ guard: new Guard() });
        });

        await assert.rejects(client.joinOrCreate('instance_auth'), /blocked by plugin/);
      });
    });

  });
});
