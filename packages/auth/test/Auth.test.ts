import assert from "assert";
import http from "http";
import crypto from "crypto";
import * as httpie from "httpie";
import { JWT, auth, Hash, type JwtPayload, } from "../src/index.ts";
import express from "express";

const TEST_PORT = 8888;

function get(segments: string, opts: Partial<httpie.Options> = undefined) {
  return httpie.get(`http://localhost:${TEST_PORT}${segments}`, opts);
}
function post(segments: string, opts: Partial<httpie.Options> = undefined) {
  return httpie.post(`http://localhost:${TEST_PORT}${segments}`, opts);
}

const passwordPlainText = "123456";

// JWT Secret for testing
// JWT.options.verify.algorithms = ['HS512'];
JWT.settings.secret = "@%^&";

describe("Auth", () => {

  let app: ReturnType<typeof express>;
  let server: http.Server;
  let fakedb: any = {};
  let onRegisterOptions: any;

  beforeEach(async () => {
    app = express();
    app.use(auth.prefix, auth.routes({

      onRegisterWithEmailAndPassword: async (email: string, password: string, options: any) => {
        fakedb[email] = password;
        onRegisterOptions = options;
        return { id: 100, email };
      },

      onFindUserByEmail: async (email: string) => {
        if (fakedb[email] !== undefined) {
          return { id: 100, email, password: fakedb[email] };
        } else {
          return null;
        }
      },

      // onGenerateToken
    }));
    app.get("/unprotected_route", (req, res) => res.json({ ok: true }));
    app.get("/protected_route", auth.middleware(), (req, res) => res.json({ ok: true }));

    fakedb = {}; // reset fakedb
    onRegisterOptions = undefined; // reset onRegisterOptions

    return new Promise<void>((resolve) => {
      server = app.listen(TEST_PORT, () => resolve());
    })
  });
  afterEach(() => server.close());

  describe("anonymous", () => {
    it("should allow to sign-in as 'anonymous'", async () => {
      const signIn = await post("/auth/anonymous");
      assert.ok(signIn.data.user);
      assert.ok(signIn.data.user.anonymousId);
      assert.ok(signIn.data.user.anonymous);
      assert.ok(signIn.data.token);
    });
  });

  describe("email/password", () => {
    it("onRegister: should allow to register", async () => {
      const register = await post("/auth/register", {
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: "endel@colyseus.io",
          password: passwordPlainText
        }),
      });

      // Each Hash.make() call uses a fresh random salt, so the stored
      // value can't be reconstructed by re-hashing — verify() is the
      // correct primitive.
      assert.ok(await Hash.verify(passwordPlainText, fakedb["endel@colyseus.io"]!));
      assert.deepStrictEqual({ id: 100, email: "endel@colyseus.io", }, register.data.user);

      const token: any = await JWT.verify(register.data.token);
      assert.strictEqual(register.data.user.id, token.id);
      assert.strictEqual(register.data.user.email, token.email);
    });

    it("onRegister: should allow to upgrade token", async () => {
      const register = await post("/auth/register", {
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${await JWT.sign({ id: 50, name: "Anonymous" })}`
        },
        body: JSON.stringify({
          email: "endel@colyseus.io",
          password: passwordPlainText
        }),
      });

      assert.strictEqual(onRegisterOptions.upgradingToken.id, 50);
      assert.strictEqual(onRegisterOptions.upgradingToken.name, "Anonymous");

      assert.ok(await Hash.verify(passwordPlainText, fakedb["endel@colyseus.io"]!));
      assert.deepStrictEqual({ id: 100, email: "endel@colyseus.io", }, register.data.user);

      const token: any = await JWT.verify(register.data.token);
      assert.strictEqual(register.data.user.id, token.id);
      assert.strictEqual(register.data.user.email, token.email);
    });

    it("onLogin: should allow to login", async () => {
      // create fake db entry
      fakedb["endel@colyseus.io"] = await Hash.make(passwordPlainText);

      assert.rejects(async () => {
        await post("/auth/login", {
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            email: "endel@colyseus.io",
            password: "badpassword"
          }),
        });
      });

      const loginSuccess = await post("/auth/login", {
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: "endel@colyseus.io",
          password: passwordPlainText
        }),
      });

      assert.deepStrictEqual({ id: 100, email: "endel@colyseus.io", }, loginSuccess.data.user);

      const token: any = await JWT.verify(loginSuccess.data.token);
      assert.strictEqual(loginSuccess.data.user.id, token.id);
      assert.strictEqual(loginSuccess.data.user.email, token.email);
    });
  });

  describe("JWT", () => {
    it("should sign and verify token", async () => {
      const data = { id: 1, name: "Jake Badlands", email: "jake@badlands.io" }
      const token = await JWT.sign(data);

      const verify = await JWT.verify(token) as JwtPayload;
      delete verify.iat;

      assert.deepEqual(data, verify);
    });
  });

  describe("Hash", () => {
    it("verify accepts the new salted format and round-trips", async () => {
      const stored = await Hash.make("123456");
      // Format is `<algo>$<salt-hex>$<hash-hex>`.
      const parts = stored.split("$");
      assert.equal(parts.length, 3);
      assert.equal(parts[0], "scrypt");
      assert.ok(parts[1] && parts[1].length === 32, "salt is 16 random bytes (32 hex chars)");
      assert.ok(await Hash.verify("123456", stored));
      assert.ok(!(await Hash.verify("wrong", stored)));
    });

    it("two make() calls for the same password produce different stored values", async () => {
      const a = await Hash.make("samepass");
      const b = await Hash.make("samepass");
      assert.notStrictEqual(a, b);
      assert.ok(await Hash.verify("samepass", a));
      assert.ok(await Hash.verify("samepass", b));
    });

    it("verify falls back to the legacy raw-hex format for backward compat", async () => {
      // Legacy: scrypt(plain, AUTH_SALT || '## SALT ##') without algo prefix.
      const legacy = await new Promise<string>((resolve, reject) => {
        crypto.scrypt("123456", "## SALT ##", 64, (err, derivedKey) => {
          if (err) { reject(err); } else { resolve(derivedKey.toString("hex")); }
        });
      });
      assert.ok(Hash.isLegacy(legacy));
      assert.ok(await Hash.verify("123456", legacy));
      assert.ok(!(await Hash.verify("wrong", legacy)));
    });

    it("supports switching algorithm for new hashes", async () => {
      Hash.algorithm = "sha1";
      const stored = await Hash.make("123456");
      assert.ok(stored.startsWith("sha1$"));
      assert.ok(await Hash.verify("123456", stored));
      // revert to default algorithm
      Hash.algorithm = "scrypt";
    });
  })

});