import assert from "assert";
import http from "http";
import * as httpie from "httpie";
import { auth } from "../src/index.ts";
import { createRouter } from "@colyseus/better-call";
import { toNodeHandler } from "@colyseus/better-call/node";
import { matchMaker } from "@colyseus/core";

const TEST_PORT = 8889;

function get(segments: string, opts: Partial<httpie.Options> = undefined) {
  return httpie.get(`http://localhost:${TEST_PORT}${segments}`, opts);
}

describe("Auth: oauth bridge", () => {
  let server: http.Server;
  const originalNodeEnv = process.env.NODE_ENV;

  // Register a fake provider so grant will happily build an authorize URL
  // without contacting a real OAuth server. `matchMaker.setup()` is needed
  // because the OAuth bridge waits on `matchMaker.onReady` before serving.
  before(async () => {
    await matchMaker.setup(undefined, undefined);
    process.env.SESSION_SECRET = process.env.SESSION_SECRET || "oauth-test-secret";
    auth.oauth.addProvider("github", {
      key: "fake-key",
      secret: "fake-secret",
      scope: ["user:email"],
    });
  });

  beforeEach((done) => {
    const { oauthStart, oauthCallback } = auth.oauth.createEndpoints();
    const router = createRouter({ oauthStart, oauthCallback }, { openapi: { disabled: true } });
    server = http.createServer(toNodeHandler(router.handler));
    server.listen(TEST_PORT, done);
  });
  afterEach(() => server.close());
  after(() => {
    if (originalNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = originalNodeEnv;
  });

  it("exposes OAuth endpoints at the fully-qualified prefix", () => {
    const { oauthStart, oauthCallback } = auth.oauth.createEndpoints();
    assert.strictEqual(oauthStart.path, "/auth/provider/:providerId");
    assert.strictEqual(oauthCallback.path, "/auth/provider/:providerId/callback");
    assert.strictEqual(oauthStart.options.method, "GET");
    assert.strictEqual(oauthCallback.options.method, "GET");
  });

  it("renders the missing-provider help page for an unknown provider (dev mode)", async () => {
    process.env.NODE_ENV = "development";
    const response = await get("/auth/provider/unknownprovider");
    assert.strictEqual(response.statusCode, 200);
    const body = String(response.data);
    assert.match(body, /Missing config for "unknownprovider"/);
    assert.match(body, /auth\.oauth\.addProvider/);
  });

  it("returns a terse message for an unknown provider in production", async () => {
    process.env.NODE_ENV = "production";
    const response = await get("/auth/provider/unknownprovider");
    assert.strictEqual(response.statusCode, 200);
    assert.match(String(response.data), /Missing OAuth provider configuration for "unknownprovider"/);
  });

  it("redirects to the provider's authorize URL and sets a session cookie", async () => {
    // Reset env so grant initializes in a neutral mode.
    process.env.NODE_ENV = "test";

    const response: any = await get("/auth/provider/github", { redirect: false as any }).catch((e) => e);

    // httpie follows redirects by default; both a 302 "thrown" error and a
    // naturally-returned response with Location header are acceptable. Grant
    // will respond with either a 302 (when session is configured) or an
    // error response mentioning the provider.
    const statusCode = response.statusCode ?? response.status ?? 0;
    const headers = response.headers ?? {};
    const location = headers["location"] || headers["Location"];
    const setCookie = headers["set-cookie"] || headers["Set-Cookie"];

    assert.ok(
      statusCode === 302 || statusCode === 301,
      `expected a redirect, got status ${statusCode} with body ${response.data}`,
    );
    assert.ok(location, "Location header should be set");
    assert.match(String(location), /github\.com\/login\/oauth\/authorize/);
    assert.ok(setCookie, "express-session should set a cookie");
  });
});
