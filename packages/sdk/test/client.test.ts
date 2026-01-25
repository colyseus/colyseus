import './util';
import { describe, beforeAll, test } from "vitest";
import { assert } from "chai";
import { Client, type ISeatReservation } from "../src/Client.ts";
import { Schema, type } from '@colyseus/schema';
import { discordURLBuilder } from '../src/3rd_party/discord.ts';

import { defineServer, defineRoom, Room } from "@colyseus/core";

describe("Client", function () {
    let client: Client;

    beforeAll(() => {
        client = new Client("ws://localhost:2546");
    })

    describe("constructor settings", () => {
        test("url string", () => {
            const room = { roomId: "roomId", processId: "processId", sessionId: "sessionId", } as ISeatReservation;
            const roomWithPublicAddress = { publicAddress: "node-1.colyseus.cloud", roomId: "roomId", processId: "processId", sessionId: "sessionId", } as ISeatReservation;

            const settingsByUrl = {
                'ws://localhost:2567': {
                    settings: { hostname: "localhost", port: 2567, secure: false, },
                    httpEndpoint: "http://localhost:2567/",
                    wsEndpoint: "ws://localhost:2567/processId/roomId?",
                    wsEndpointPublicAddress: "ws://node-1.colyseus.cloud/processId/roomId?"
                },
                'wss://localhost:2567': {
                    settings: { hostname: "localhost", port: 2567, secure: true, },
                    httpEndpoint: "https://localhost:2567/",
                    wsEndpoint: "wss://localhost:2567/processId/roomId?",
                    wsEndpointPublicAddress: "wss://node-1.colyseus.cloud/processId/roomId?"
                },
                'http://localhost': {
                    settings: { hostname: "localhost", port: 80, secure: false, },
                    httpEndpoint: "http://localhost/",
                    wsEndpoint: "ws://localhost/processId/roomId?",
                    wsEndpointPublicAddress: "ws://node-1.colyseus.cloud/processId/roomId?"
                },
                'https://localhost/custom/path': {
                    settings: { hostname: "localhost", port: 443, secure: true, pathname: "/custom/path" },
                    httpEndpoint: "https://localhost/custom/path/",
                    wsEndpoint: "wss://localhost/custom/path/processId/roomId?",
                    wsEndpointPublicAddress: "wss://node-1.colyseus.cloud/processId/roomId?"
                },
                'https://localhost/custom/path?with=query&params=true': {
                    settings: { hostname: "localhost", port: 443, secure: true, pathname: "/custom/path", searchParams: "with=query&params=true" },
                    httpEndpoint: "https://localhost/custom/path/?with=query&params=true",
                    wsEndpoint: "wss://localhost/custom/path/processId/roomId?with=query&params=true",
                    wsEndpointPublicAddress: "wss://node-1.colyseus.cloud/processId/roomId?with=query&params=true"
                },
                '/api': {
                    settings: { hostname: "127.0.0.1", port: 2567, secure: false, pathname: "/api" },
                    httpEndpoint: "http://127.0.0.1:2567/api/",
                    wsEndpoint: "ws://127.0.0.1:2567/api/processId/roomId?",
                    wsEndpointPublicAddress: "ws://node-1.colyseus.cloud/processId/roomId?"
                },
            };

            for (const url in settingsByUrl) {
                const expected = settingsByUrl[url]
                const client = new Client(url);
                const settings = client['settings'];
                assert.strictEqual(expected.settings.hostname, settings.hostname);
                assert.strictEqual(expected.settings.port, settings.port);
                assert.strictEqual(expected.settings.secure, settings.secure);
                assert.strictEqual(expected.settings.searchParams, settings.searchParams);
                assert.strictEqual(expected.httpEndpoint, client['getHttpEndpoint']());
                assert.strictEqual(expected.wsEndpoint, client['buildEndpoint'](room));
                assert.strictEqual(expected.wsEndpointPublicAddress, client['buildEndpoint'](roomWithPublicAddress));

                const clientWithSettings = new Client(expected.settings);
                assert.strictEqual(expected.settings.hostname, clientWithSettings['settings'].hostname);
                assert.strictEqual(expected.settings.port, clientWithSettings['settings'].port);
                assert.strictEqual(expected.settings.secure, clientWithSettings['settings'].secure);
                assert.strictEqual(expected.httpEndpoint, clientWithSettings['getHttpEndpoint']());
                assert.strictEqual(expected.wsEndpoint, clientWithSettings['buildEndpoint'](room));
                assert.strictEqual(expected.wsEndpointPublicAddress, clientWithSettings['buildEndpoint'](roomWithPublicAddress));
            }
        });

        test("discord url builder", () => {
            const room = { roomId: "roomId", processId: "processId", sessionId: "sessionId", } as ISeatReservation ;
            const roomWithPublicAddress = { publicAddress: "node-1.colyseus.cloud", roomId: "roomId", processId: "processId", sessionId: "sessionId", } as ISeatReservation;

            const settingsByUrl = {
                'ws://example.com': {
                    httpEndpoint: "http://localhost/.proxy/colyseus/",
                    wsEndpoint: "ws://localhost/.proxy/colyseus/processId/roomId",
                    wsEndpointPublicAddress: "ws://localhost/.proxy/colyseus/node-1/processId/roomId"
                },
                'ws://subdomain.colyseus.cloud': {
                    httpEndpoint: "http://localhost/.proxy/colyseus/subdomain/",
                    wsEndpoint: "ws://localhost/.proxy/colyseus/subdomain/processId/roomId",
                    wsEndpointPublicAddress: "ws://localhost/.proxy/colyseus/node-1/processId/roomId"
                },
                'https://subdomain.colyseus.cloud/custom/path': {
                    httpEndpoint: "https://localhost/.proxy/colyseus/subdomain/custom/path/",
                    wsEndpoint: "wss://localhost/.proxy/colyseus/subdomain/custom/path/processId/roomId",
                    wsEndpointPublicAddress: "wss://localhost/.proxy/colyseus/node-1/processId/roomId"
                },
                // '/api': {
                //     httpEndpoint: "http://127.0.0.1:2567/api/",
                //     wsEndpoint: "ws://127.0.0.1:2567/api/processId/roomId",
                //     wsEndpointPublicAddress: "ws://node-1.colyseus.cloud/processId/roomId"
                // },
            };

            for (const url in settingsByUrl) {
                const expected = settingsByUrl[url];
                const client = new Client(url, { urlBuilder: discordURLBuilder });
                assert.strictEqual(expected.httpEndpoint, client['getHttpEndpoint']());
                assert.strictEqual(expected.wsEndpoint, client['buildEndpoint'](room));
                assert.strictEqual(expected.wsEndpointPublicAddress, client['buildEndpoint'](roomWithPublicAddress));
            }
        });
    });

    test.skip("join", function () {
        const room = client.join("chat");
        // assert.equal(room.name, "chat")
        // assert.deepEqual(room.state, {})
    });

    test.skip("should allow to pass a Schema constructor as third argument", async () => {
        class State extends Schema {
            @type("string") str: string;
        }

        const room = await client.joinOrCreate("chat", {}, State);
        room.state.str

    });

    describe("typescript inference using server type", () => {
        // define server types
        class MyState extends Schema {
            @type("string") str: string;
        }
        class MyRoom extends Room {
            state = new MyState();
            messages = {
                chat: (client, message: { text: string }) => {
                    client.send("chat", { text: "hello" });
                }
            }
        }

        // These tests verify TypeScript type inference at compile-time.
        // They are skipped at runtime since they require a running server.

        describe("passing RoomType directly as generic", () => {
            // Type-only reference for compile-time checks (no actual server instantiation)
            type ServerType = ReturnType<typeof defineServer<{ chat: ReturnType<typeof defineRoom<typeof MyRoom>> }, undefined>>;
            const client = new Client<ServerType>("ws://localhost:2546");

            test.skip("joinOrCreate should infer state type", async () => {
                const room = await client.joinOrCreate("chat");
                // TypeScript should infer room.state as MyState
                const str: string = room.state.str;

                assert.ok(str);
                room.send("chat", { text: "hello" });

                // @ts-expect-error - room.state.error should not exist
                room.send("chat", { invalid_type: "hello" });

                // @ts-expect-error - room.state.error should not exist
                room.send("invalid-message-type");

                // @ts-expect-error - room.state.error should not exist
                const _ = room.state.error;
            });

            test.skip("joinOrCreate with concrete class should infer state type", async () => {
                const room = await client.joinOrCreate("chat", {}, MyState);
                // TypeScript should infer room.state as MyState
                const str: string = room.state.str;

                assert.ok(str);
                room.send("chat", { text: "hello" });

                // @ts-expect-error - room.state.error should not exist
                room.send("chat", { invalid_type: "hello" });

                // @ts-expect-error - room.state.error should not exist
                room.send("invalid-message-type");

                // @ts-expect-error - room.state.error should not exist
                const _ = room.state.error;
            });

            test.skip("joinOrCreate<RoomType> should infer state type", async () => {
                const room = await client.joinOrCreate<MyRoom>("chat");
                // TypeScript should infer room.state as MyState
                const str: string = room.state.str;

                assert.ok(str);
                room.send("chat", { text: "hello" });

                // @ts-expect-error - room.state.error should not exist
                room.send("chat", { invalid_type: "hello" });

                // @ts-expect-error - room.state.error should not exist
                room.send("invalid-message-type");

                // @ts-expect-error - room.state.error should not exist
                const _ = room.state.error;
            });

            test.skip("create should infer state type", async () => {
                const room = await client.create("chat");
                // TypeScript should infer room.state as MyState
                const str: string = room.state.str;
                assert.ok(str);

                // @ts-expect-error - room.state.error should not exist
                const _ = room.state.error;
            });

            test.skip("create<RoomType> should infer state type", async () => {
                const room = await client.create<MyRoom>("chat");
                // TypeScript should infer room.state as MyState
                const str: string = room.state.str;
                assert.ok(str);

                // @ts-expect-error - room.state.error should not exist
                const _ = room.state.error;
            });

            test.skip("join<RoomType> should infer state type", async () => {
                const room = await client.join("chat");
                // TypeScript should infer room.state as MyState
                const str: string = room.state.str;
                assert.ok(str);

                // @ts-expect-error - room.state.error should not exist
                const _ = room.state.error;
            });

            test.skip("join<RoomType> should infer state type", async () => {
                const room = await client.join<MyRoom>("chat");
                // TypeScript should infer room.state as MyState
                const str: string = room.state.str;
                assert.ok(str);

                // @ts-expect-error - room.state.error should not exist
                const _ = room.state.error;
            });

            test.skip("joinById<RoomType> should infer state type", async () => {
                const room = await client.joinById<MyRoom>("roomId");
                // TypeScript should infer room.state as MyState
                const str: string = room.state.str;
                assert.ok(str);

                // @ts-expect-error - room.state.error should not exist
                const _ = room.state.error;
            });

            test.skip("reconnect<RoomType> should infer state type", async () => {
                const room = await client.reconnect<MyRoom>("roomId:token");
                // TypeScript should infer room.state as MyState
                const str: string = room.state.str;
                assert.ok(str);

                // @ts-expect-error - room.state.error should not exist
                const _ = room.state.error;
            });
        });

        describe("inferring room type from server definition", () => {
            let client: Client;

            test.skip("should infer room type from server type", async () => {
                const room = await client.joinOrCreate("chat");
                // TypeScript should infer room.state as MyState
                const str: string = room.state.str;
                assert.ok(str);

                const _ = room.state.error;
            });
        });
    });

});
