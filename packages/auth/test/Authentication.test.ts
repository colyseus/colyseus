import assert from "assert";
import type http from "http";
import * as httpie from "httpie";
import { JWT, auth, Hash } from "../src/index";
import express from "express";

const TEST_PORT = 8888;

function get(segments: string, opts: Partial<httpie.Options> = undefined) {
  return httpie.get(`http://localhost:${TEST_PORT}${segments}`, opts);
}
function post(segments: string, opts: Partial<httpie.Options> = undefined) {
  return httpie.post(`http://localhost:${TEST_PORT}${segments}`, opts);
}

const email = "endel@colyseus.io";
const password = "123456";

// JWT Secret for testing
// JWT.options.verify.algorithms = ['HS512'];
JWT.settings.secret = "@%^&";

class DB {
  db: Map<number, any>;

  constructor() {
    this.db = new Map();
  }
  async findUserByEmail(email: string) {
    const user = Array
      .from(this.db.values())
      .find((u) => u.email === email);
    return user;
  }
  async createUser(data: any) {
    const user = {
      ...data,
      id: this.db.size + 1,
    };
    this.db.set(user.id, user);
    return user;
  }
  clear() {
    this.db.clear();
  }
}

describe("Auth:onFindUserByEmail", () => {
  let app: ReturnType<typeof express>;
  let server: http.Server;
  const db = new DB();

  beforeEach(async () => {
    app = express();
    app.use(auth.prefix, auth.routes({
      onRegisterWithEmailAndPassword: async (email, password, options) => {
        return db.createUser({ ...options, email, password });
      },
  
      onFindUserByEmail: async (email: string) => {
        return db.findUserByEmail(email) as Promise<{ password: string }>;
      },
    }));

    db.clear();

    return new Promise((resolve) => {
      server = app.listen(TEST_PORT, () => resolve() );
    })
  });

  afterEach(async () => {
    server.close();
    await new Promise((resolve) => setTimeout(resolve, 100));
  });

  it("login: should not mutate the user object", async () => {
    await db.createUser({ email, password: await Hash.make(password) });

    const login = await post("/auth/login", {
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email,
        password,
      }),
    });
    const user = await db.findUserByEmail(email);
    assert.equal(user.password, await Hash.make(password));
    assert.equal(login.data.user.password, undefined);
  });

  it("register: should not mutate the user object", async () => {
    const register = await post("/auth/register", {
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email,
        password,
      }),
    });
    const user = await db.findUserByEmail(email);
    assert.equal(user.password, await Hash.make(password));
    assert.equal(register.data.user.password, undefined);
  });
});
