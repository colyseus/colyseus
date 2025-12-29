import assert from "assert";
import http from "http";
import * as httpie from "httpie";
import { JWT, auth, Hash, type JwtPayload, } from "../src/index.ts";
import express from "express";
import { createEndpoint, createRouter } from "@colyseus/better-call";
import { toNodeHandler } from "@colyseus/better-call/node";

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

// Create better-call endpoints using auth.betterCall() middleware
const betterCallUnprotectedRoute = createEndpoint("/better-call-route/unprotected", {
    method: "GET",
}, async (ctx) => {
    return { ok: true };
});

const betterCallProtectedRoute = createEndpoint("/better-call-route/protected", {
    method: "GET",
    use: [auth.middleware()],
}, async (ctx) => {
    return { ok: true, auth: ctx.context.auth };
});

// Create the router
const betterCallRouter = createRouter({
    betterCallUnprotectedRoute,
    betterCallProtectedRoute,
}, {
    openapi: { disabled: true },
});

describe("Auth: middleware", () => {

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
        app.get("/protected_route", auth.middleware(), (req: any, res) => res.json({ ok: true, auth: req.auth }));

        // Add better-call routes
        app.use(toNodeHandler(betterCallRouter.handler));

        fakedb = {}; // reset fakedb
        onRegisterOptions = undefined; // reset onRegisterOptions

        return new Promise<void>((resolve) => {
            server = app.listen(TEST_PORT, () => resolve());
        })
    });
    afterEach(() => server.close());

    describe("express middleware", () => {
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
            assert.strictEqual(protected_route.ok, true);
            assert.ok(protected_route.auth, "auth data should be present");
            assert.ok(protected_route.auth.anonymous, "auth.anonymous should be true");
            assert.ok(protected_route.auth.anonymousId, "auth.anonymousId should be present");
        });
    })

    describe("better-call middleware", () => {
        it("should restrict access to protected routes", async () => {
            // Access unprotected route without token
            const unprotected_route = (await get("/better-call-route/unprotected")).data;
            assert.deepStrictEqual({ ok: true }, unprotected_route);

            // Access protected route without token should fail
            await assert.rejects(async () => {
                await get("/better-call-route/protected");
            }, "Should not be able to access protected route without token");

            // Access protected route with invalid token should fail
            await assert.rejects(async () => {
                await get("/better-call-route/protected", {
                    headers: { Authorization: `Bearer invalidtoken` },
                });
            }, "Should not be able to access protected route with invalid token");

            // Sign in and access protected route with valid token
            const signIn = await post("/auth/anonymous");
            const protected_route = (await get("/better-call-route/protected", {
                headers: { Authorization: `Bearer ${signIn.data.token}` },
            })).data;
            assert.strictEqual(protected_route.ok, true);
            assert.ok(protected_route.auth, "auth data should be present");
            assert.ok(protected_route.auth.anonymous, "auth.anonymous should be true");
            assert.ok(protected_route.auth.anonymousId, "auth.anonymousId should be present");
        });
    });

});