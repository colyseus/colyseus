import './util';
import { describe, beforeAll, test, afterAll, beforeEach } from "vitest";
import assert from "assert";
import { Client, ServerError, AbortError } from "../src/index.ts";

import { createServer } from 'http';
import type { AddressInfo } from 'net';

function handler(req, res) {
    setTimeout(() => {
        res.setHeader('Content-Type', 'application/json');

        if (req.url === '/error') {
            res.statusCode = 400;
            res.end(JSON.stringify({ code: 1001, message: 'Bad request error' }));
            return;
        }

        if (req.url === '/server-error') {
            res.statusCode = 500;
            res.end(JSON.stringify({ code: 5000, message: 'Internal server error' }));
            return;
        }

        if (req.url === '/anything') {
            res.end(JSON.stringify({ message: 'ok' }));
            return;
        }

        res.end('{invalid_json');
    }, 60);
}

export async function startDummyLocalServer() {
	return new Promise(res => {
		let app = createServer(handler).listen();
		let close = app.close.bind(app);
		let { port } = app.address() as AddressInfo;
		return res({ port, close });
	});
}


describe("HTTP", function() {
    let client: Client;
    let localServer: any;

    beforeAll(async () => {
        localServer = await startDummyLocalServer();
    });

    beforeEach(() => {
        client = new Client(`http://localhost:${localServer.port}`);
    });

    afterAll(() => {
        localServer.close();
    });

    test("when untyped, response.data should resolve as 'any'", async () => {
        const response = await client.http.get("/anything");
        assert.strictEqual(response.data.length, undefined);
    });

    describe("errors", () => {
        test("should return 'offline' error when requesting offline service", async () => {
            client = new Client(`http://localhost:9090`);
            try {
                await client.http.post("/anything");
            } catch (e) {
                console.log(e);
                if (e instanceof ServerError) {
                    assert.strictEqual(e.code, 'ECONNREFUSED')
                } else {
                }
            }
        });

        test("should throw ServerError with code, message, status and headers on error response", async () => {
            let serverError: ServerError | undefined = undefined;

            try {
                await client.http.get("/error");
            } catch (e) {
                if (e instanceof ServerError) {
                    serverError = e;
                }
            }

            assert.ok(serverError, "Expected ServerError to be thrown");
            assert.strictEqual(serverError!.code, 1001);
            assert.strictEqual(serverError!.message, 'Bad request error');
            assert.strictEqual(serverError!.status, 400);
            assert.ok(serverError!.headers instanceof Headers);
            assert.ok(serverError!.response instanceof Response);
        });

        test("should throw ServerError on 500 response", async () => {
            let serverError: ServerError | undefined = undefined;

            try {
                await client.http.get("/server-error");
            } catch (e) {
                if (e instanceof ServerError) {
                    serverError = e;
                }
            }

            assert.ok(serverError, "Expected ServerError to be thrown");
            assert.strictEqual(serverError!.code, 5000);
            assert.strictEqual(serverError!.message, 'Internal server error');
            assert.strictEqual(serverError!.status, 500);
        });
    });

    describe("AbortController", () => {
        test("should abort request", async () => {
            let abortError: AbortError | undefined = undefined;

            const controller = new AbortController();
            setTimeout(() => controller.abort(), 5);

            try {
                await client.http.get("/anything", { signal: controller.signal });

            } catch (e: any) {
                abortError = e;
            }

            assert.ok(abortError);
            assert.strictEqual(abortError!.name, 'AbortError');
        });
    });

});
