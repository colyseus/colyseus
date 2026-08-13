//
// Fixture for `tree-shaking.test.ts` — the shape of a consumer app that uses
// the SDK without any prediction. Nothing here may reach `src/predict*`.
//
import { Client, getStateCallbacks, Room } from "../../src/index.ts";

export function boot(endpoint: string) {
    const client = new Client(endpoint);
    return { client, getStateCallbacks, Room };
}
