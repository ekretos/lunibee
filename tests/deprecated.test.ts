import { describe, expect, test } from "bun:test";
import { Client } from "../packages/core/src/index.ts";
import { Routes } from "../packages/rest/src/index.ts";
import {
    CreateSlashCommand,
    CreateUserCommand,
} from "../packages/builders/src/index.ts";

// Deprecated APIs that still work in 0.2.x and are removed in 0.3.0.
// Delete each case together with the API it covers.

describe("deprecated in 0.2.3, removed in 0.3.0", () => {
    test("Routes.channelPins / channelPin keep Discord's old paths", () => {
        const channel = "123456789012345680";
        const message = "123456789012345681";
        expect(Routes.channelPins(channel)).toBe(`/channels/${channel}/pins`);
        expect(Routes.channelPin(channel, message)).toBe(
            `/channels/${channel}/pins/${message}`,
        );
    });

    test("setDMPermission still sends dm_permission unchanged", () => {
        expect(
            new CreateSlashCommand()
                .setName("ping")
                .setDescription("Ping")
                .setDMPermission(false)
                .toJSON().dm_permission,
        ).toBe(false);
        expect(
            new CreateUserCommand()
                .setName("Profile")
                .setDMPermission(true)
                .toJSON().dm_permission,
        ).toBe(true);
    });

    test("fetchInvite({ withExpiration }) is accepted and no longer sent", async () => {
        const client = new Client({ token: "t", intents: 0 });
        const paths: string[] = [];
        (client.rest as unknown as { get: unknown }).get = async (
            path: string,
        ) => {
            paths.push(path);
            return {};
        };
        await client.fetchInvite("abc", {
            withCounts: true,
            withExpiration: true,
        });
        expect(paths).toEqual(["/invites/abc?with_counts=true"]);
    });
});
