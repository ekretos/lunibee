import { describe, expect, test } from "bun:test";
import { Client } from "../packages/core/src/index.ts";
import { HttpTransport, REST, Routes } from "../packages/rest/src/index.ts";
import {
    ChannelManager,
    GuildManager,
} from "../packages/managers/src/index.ts";
import { Channel } from "../packages/structures/src/index.ts";
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
    test("deprecated names forward to remove()", async () => {
        const calls: { method: string; path: string }[] = [];
        const rest = new REST({
            token: "token",
            transport: new HttpTransport({
                fetch: async (url, init) => {
                    calls.push({
                        method: init?.method ?? "GET",
                        path: new URL(url).pathname.replace("/api/v10", ""),
                    });
                    return new Response(null, { status: 204 });
                },
            }),
        });
        const guilds = new GuildManager(rest);
        const channels = new ChannelManager(rest, { messageCache: {} });
        const GUILD = "100000000000000001";
        const ID = "100000000000000002";
        await guilds.roles(GUILD).deleteRole(ID);
        await guilds.emojis(GUILD).deleteEmoji(ID);
        await channels.deleteChannel(ID);
        await guilds.deleteGuild(GUILD);
        expect(calls.map((c) => [c.method, c.path])).toEqual([
            ["DELETE", `/guilds/${GUILD}/roles/${ID}`],
            ["DELETE", `/guilds/${GUILD}/emojis/${ID}`],
            ["DELETE", `/channels/${ID}`],
            ["DELETE", `/guilds/${GUILD}`],
        ]);
    });

    test("Channel.sendMessage / ChannelManager.sendMessage forward to send()", async () => {
        const sent: unknown[] = [];
        const channel = new Channel(
            { id: "100000000000000002", type: 0 } as never,
            {
                sendMessage: async (_id: string, options: unknown) => {
                    sent.push(options);
                    return {} as never;
                },
            } as never,
        );
        await channel.sendMessage({ content: "hi" });
        expect(sent).toEqual([{ content: "hi" }]);
        const channels = new ChannelManager({} as never, { messageCache: {} });
        let forwarded = false;
        channels.send = (async () => {
            forwarded = true;
            return {} as never;
        }) as never;
        await channels.sendMessage("100000000000000002", { content: "hi" });
        expect(forwarded).toBe(true);
    });

    test("ChannelManager.bulkDelete forwards to bulkDeleteMessages", async () => {
        const channels = new ChannelManager({} as never, { messageCache: {} });
        const seen: unknown[] = [];
        channels.bulkDeleteMessages = (async (...args: unknown[]) => {
            seen.push(args);
        }) as never;
        await channels.bulkDelete("100000000000000002", ["1", "2"]);
        expect(seen).toEqual([["100000000000000002", ["1", "2"]]]);
    });
});
