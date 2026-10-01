import { expect, test } from "bun:test";
import {
    HttpTransport,
    REST,
    RESTError,
    RESTErrorCode,
} from "../packages/rest/src/index.ts";

test("RESTErrorCode names Discord's JSON error codes, one name per code", () => {
    expect(RESTErrorCode.UnknownMessage).toBe(10008);
    expect(RESTErrorCode.UnknownMember).toBe(10007);
    expect(RESTErrorCode.MissingAccess).toBe(50001);
    expect(RESTErrorCode.MissingPermissions).toBe(50013);
    const values = Object.values(RESTErrorCode);
    expect(new Set(values).size).toBe(values.length);
    expect(values.every((code) => Number.isInteger(code))).toBe(true);
});

function failingRest(status: number, body: unknown) {
    return new REST({
        token: "bot-token",
        retries: 0,
        transport: new HttpTransport({
            fetch: async () =>
                new Response(JSON.stringify(body), {
                    status,
                    headers: { "content-type": "application/json" },
                }),
        }),
    });
}

test("a 50013 error carries its code, a hint, and no credentials", async () => {
    const rest = failingRest(403, {
        code: 50013,
        message: "Missing Permissions",
    });
    const error = await rest
        .post("/webhooks/100000000000000001/secret-webhook-token", {})
        .catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(RESTError);
    const rejected = error as RESTError;
    expect(rejected.code).toBe(RESTErrorCode.MissingPermissions);
    expect(rejected.kind).toBe("permission");
    expect(rejected.message).toBe("Missing Permissions");
    expect(rejected.hint).toContain("highest role");
    const visible = [rejected.message, rejected.hint, rejected.path].join(" ");
    expect(visible).not.toContain("secret-webhook-token");
    expect(visible).not.toContain("bot-token");
});

test("errors without a common cause have no hint", async () => {
    const rest = failingRest(404, { code: 10008, message: "Unknown Message" });
    const error = (await rest
        .get("/channels/100000000000000001/messages/100000000000000002")
        .catch((caught: unknown) => caught)) as RESTError;
    expect(error.code).toBe(RESTErrorCode.UnknownMessage);
    expect(error.hint).toBeUndefined();
});
