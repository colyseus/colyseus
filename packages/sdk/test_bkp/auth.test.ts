import './util';
import { describe, beforeAll, test } from "vitest";
import assert from "assert";
import { Client, Room } from "../src";
import { AuthData } from '../src/Auth';

describe("Auth", function() {
    let client: Client;

    beforeAll(() => {
        client = new Client("ws://localhost:2546");
    });

    describe("store token", () => {
        test("should store token on localStorage", () => {
            client.auth['emitChange']({ user: {}, token: "123" });
            assert.strictEqual("123", client.auth.token);
            assert.strictEqual("123", window.localStorage.getItem(client.auth.settings.key));
        });

        test("should reject if no token is stored", async () => {
            // @ts-ignore
            client.auth.token = undefined;

            await assert.rejects(async () => {
                await client.auth.getUserData();
            }, /missing auth.token/);
        });

    });

    describe("onChange", () => {
        test("should trigger onChange when token is set", () => {
            let onChangePayload: AuthData | undefined = undefined;
            client.auth.onChange((data) => onChangePayload = data);
            client.auth['emitChange']({ user: { dummy: true }, token: "123" });
            assert.strictEqual("123", client.auth.token);
            assert.strictEqual("123", client.http.authToken);

            client.auth.onChange((data) => onChangePayload = data);
            client.auth['emitChange']({ user: { dummy: true }, token: null } as any);
            assert.strictEqual(null, client.auth.token);
            assert.strictEqual(null, client.http.authToken);
        });

    });

});
