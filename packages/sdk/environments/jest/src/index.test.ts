import expect from "expect";
import { connect } from "./index";

// fetch must be available for `jest`
import fetch from "node-fetch";
global.fetch = fetch;

async function timeout(ms: number = 200) {
    return new Promise((resolve, _) => setTimeout(resolve, ms));
}

test('should connect to the server', async () => {
    const room = await connect();
    await timeout()
    expect(room).toBeTruthy();
    expect(room.state).toBeTruthy();
});