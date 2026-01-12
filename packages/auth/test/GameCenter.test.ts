import assert from "assert";
import http from "http";
import * as httpie from "httpie";
import { JWT, auth, authenticateGameCenter } from "../src/index";
import express from "express";

const TEST_PORT = 8889;

function get(segments: string, opts: Partial<httpie.Options> = undefined) {
  return httpie.get(`http://localhost:${TEST_PORT}${segments}`, opts);
}
function post(segments: string, opts: Partial<httpie.Options> = undefined) {
  return httpie.post(`http://localhost:${TEST_PORT}${segments}`, opts);
}

// JWT Secret for testing
JWT.settings.secret = "@%^&";

// Integration test token taken from: https://github.com/maeltm/node-gamecenter-identity-verifier/blob/master/test/integrationTest.js
// Real token used to check caching behavior - sharing has no security consequences
const testToken = {
  playerId: 'G:1965586982',
  publicKeyUrl: 'https://static.gc.apple.com/public-key/gc-prod-4.cer',
  timestamp: 1565257031287,
  signature: 'uqLBTr9Uex8zCpc1UQ1MIDMitb+HUat2Mah4Kw6AVLSGe0gGNJXlih2i5X+0Z' +
    'wVY0S9zY2NHWi2gFjmhjt/4kxWGMkupqXX5H/qhE2m7hzox6lZJpH98ZEUbouWRfZX2ZhU' +
    'lCkAX09oRNi7fI7mWL1/o88MaI/y6k6tLr14JTzmlxgdyhw+QRLxRPA6NuvUlRSJpyJ4aG' +
    'tNH5/wHdKQWL8nUnFYiYmaY8R7IjzNxPfy8UJTUWmeZvMSgND4u8EjADPsz7ZtZyWAPi8kY' +
    'cAb6M8k0jwLD3vrYCB8XXyO2RQb/FY2TM4zJuI7PzLlvvgOJXbbfVtHx7Evnm5NYoyzgzw==',
  salt: 'DzqqrQ==',
  bundleId: 'cloud.xtralife.gamecenterauth'
};

describe("Game Center Auth", () => {
  let app: ReturnType<typeof express>;
  let server: http.Server;
  let fakeUsers: any = {};

  beforeEach(async () => {
    app = express();
    app.use(auth.prefix, auth.routes({
      onGameCenterAuth: async (authData) => {
        // Mock user creation/retrieval
        const user = {
          id: 123,
          playerId: authData.playerId,
          bundleId: authData.bundleId,
          platform: 'gamecenter'
        };
        fakeUsers[authData.playerId] = user;
        return user;
      }
    }));

    fakeUsers = {}; // reset fake users

    return new Promise<void>((resolve) => {
      server = app.listen(TEST_PORT, () => resolve());
    });
  });

  afterEach(() => server.close());

  describe("Game Center authentication", () => {
    it("should reject invalid Game Center credentials", async () => {
      assert.rejects(async () => {
        await post("/auth/gamecenter", {
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            playerId: "G:123456",
            bundleId: "com.test.app",
            timestamp: Date.now() / 1000,
            salt: "invalidSalt",
            signature: "invalidSignature",
            publicKeyUrl: "https://static.gc.apple.com/public-key/gc-prod-4.cer"
          }),
        });
      });
    });

    it("should require all Game Center fields", async () => {
      assert.rejects(async () => {
        await post("/auth/gamecenter", {
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            playerId: "G:123456",
            // missing required fields
          }),
        });
      });
    });
  });

  describe("caching test", () => {
    it("should verify real token (first check)", async () => {
      const result = await authenticateGameCenter(testToken);
      assert.strictEqual(result.playerId, 'G:1965586982');
      assert.strictEqual(result.bundleId, 'cloud.xtralife.gamecenterauth');
    });

    it("should take less time for cached checks", async () => {
      const start = Date.now();
      const result = await authenticateGameCenter(testToken);
      const duration = Date.now() - start;
      
      assert.strictEqual(result.playerId, 'G:1965586982');
      assert(duration < 10, 'Should be very fast due to caching');
    });
  });
});