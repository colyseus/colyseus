import './util';
import { describe, beforeAll, test, afterAll, beforeEach } from "vitest";
import assert from "assert";
import { Client } from "../src";

import { createServer, Server } from 'http';
import { AddressInfo } from 'net';
import { AbortError } from '../src/errors/Errors';

function handler(req, res) {
    setTimeout(() => {
        res.setHeader('Content-Type', 'application/json');
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

    describe("errors", () => {
        test("should return 'offline' error when requesting offline service", async () => {
            client = new Client(`http://localhost:9090`);
            try {
                await client.http.post("/anything");
            } catch (e) {
                assert.strictEqual(e.code, 'ECONNREFUSED')
            }
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
