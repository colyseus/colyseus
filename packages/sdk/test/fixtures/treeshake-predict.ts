//
// Positive control for `tree-shaking.test.ts` — same as the base fixture plus
// `Predict`, so the assertion can't pass just because the ids stopped matching.
//
import { Client, Predict } from "../../src/index.ts";

export function boot(endpoint: string) {
    const client = new Client(endpoint);
    return { client, Predict };
}
