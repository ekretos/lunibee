import { describe, expect, test } from "bun:test";
import { RESTError, abortError } from "../packages/rest/src/index.ts";

describe("RESTError classification", () => {
    test.each([
        [429, "rateLimited", true],
        [401, "authentication", false],
        [403, "permission", false],
        [404, "notFound", false],
        [400, "validation", false],
        [422, "validation", false],
        [503, "server", true],
        [0, "network", true],
        [409, "client", false],
    ] as const)("status %i is %s", (status, kind, retryable) => {
        const error = new RESTError("x", status);
        expect(error.kind).toBe(kind);
        expect(error.retryable).toBe(retryable);
    });

    test("explicit kinds win over status", () => {
        expect(
            new RESTError("x", 0, undefined, undefined, { kind: "timeout" })
                .retryable,
        ).toBe(true);
        const aborted = abortError("/x", new Error("stop"));
        expect(aborted.kind).toBe("aborted");
        expect(aborted.retryable).toBe(false);
    });
});
