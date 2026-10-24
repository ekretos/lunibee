import { describe, expect, test } from "bun:test";
import { Client, type ClientOptions } from "../packages/lunibee/src/index.ts";
import {
    MemoryRateLimitStore,
    RESTMetrics,
    type RESTRequestContext,
} from "../packages/rest/src/index.ts";

describe("ClientOptions.rest", () => {
    test("takes the REST constructor options: store, hooks, telemetry, queue limits", () => {
        const store = new MemoryRateLimitStore();
        const seen: RESTRequestContext[] = [];
        const options: ClientOptions = {
            token: "test-token",
            intents: [],
            rest: {
                store,
                hooks: { onRequest: (context) => void seen.push(context) },
                telemetry: new RESTMetrics(),
                maxQueued: 10,
                globalLimit: false,
                concurrentBuckets: false,
            },
        };
        const client = new Client(options);
        expect(client.rest.store).toBe(store);
        client.destroy();
    });

    test("the client's token wins; rest has no token of its own", () => {
        // @ts-expect-error The REST token comes from ClientOptions.token.
        const rest: ClientOptions["rest"] = { token: "other" };
        expect(rest).toBeDefined();
    });
});
