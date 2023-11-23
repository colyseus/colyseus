import assert from "assert";
import http from "http";
import * as httpie from "httpie";
import { JWT, JwtPayload, auth } from "../src/index";
import express from "express";

const TEST_PORT = 8888;

function get(segments: string, opts: Partial<httpie.Options> = undefined) {
  return httpie.get(`http://localhost:${TEST_PORT}${segments}`, opts);
}
function post(segments: string, opts: Partial<httpie.Options> = undefined) {
  return httpie.post(`http://localhost:${TEST_PORT}${segments}`, opts);
}

// JWT Secret for testing
// JWT.options.verify.algorithms = ['HS512'];
JWT.settings.secret = "@%^&";

describe("Auth", () => {

  let app: ReturnType<typeof express>;
  let server: http.Server;
  let fakedb: any = {};
  beforeEach(async () => {
    app = express();
    app.use(auth.prefix, auth.routes({
      onRegister: async (email: string, password: string) => {
        fakedb[email] = password
        return { id: 100, email, };
      },
      onLogin: async (email: string, password: string) => {
        if (fakedb[email] === password) {
          return { id: 100, email, };
        } else {
          throw new Error("Invalid credentials");
        }
      },
      // onGenerateToken
    }));
    app.get("/unprotected_route", (req, res) => res.json({ ok: true }));
    app.get("/protected_route", auth.middleware(), (req, res) => res.json({ ok: true }));
    fakedb = {}; // reset fakedb
    return new Promise<void>((resolve) => {
      server = app.listen(TEST_PORT, () => resolve());
    })
  });
  afterEach(() => server.close());

  describe("anonymous", () => {
    it("should allow to sign-in as 'anonymous'", async () => {
      const signIn = await post("/auth/anonymous");
      assert.ok(signIn.data.user);
      assert.ok(signIn.data.user.id);
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
          password: "123456"
        }),
      });

      assert.deepStrictEqual({ ["endel@colyseus.io"]: "123456" }, fakedb);
      assert.deepStrictEqual({ id: 100, email: "endel@colyseus.io", }, register.data.user);

      const token: any = await JWT.verify(register.data.token);
      assert.strictEqual(register.data.user.id, token.id);
      assert.strictEqual(register.data.user.email, token.email);
    });

    it("onLogin: should allow to login", async () => {
      // create fake db entry
      fakedb["endel@colyseus.io"] = "123456";

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
          password: "123456"
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

  describe("middleware", () => {
    it("should restrict access to protected routes", async () => {
      assert.rejects(async () => {
        await get("/protected_route", {
          headers: { Authorization: `Bearer invalidtoken` },
          withCredentials: true,
        });
      }, "Should not be able to access protected route without valid token");

      const unprotected_route = (await get("/unprotected_route")).data;
      assert.deepStrictEqual({ ok: true }, unprotected_route);

      const signIn = await post("/auth/anonymous");
      const protected_route = (await get("/protected_route", {
        headers: { Authorization: `Bearer ${signIn.data.token}` },
        withCredentials: true,
      })).data;
      assert.deepStrictEqual({ ok: true }, protected_route);
    });
  })

});