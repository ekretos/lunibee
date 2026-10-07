import { describe, expect, test } from "bun:test";
import { HttpTransport, REST } from "../packages/rest/src/index.ts";
import {
    ChannelManager,
    GuildManager,
} from "../packages/managers/src/index.ts";

// One rule: when a method takes an options object, the audit-log reason is
// `options.reason`; otherwise it is the last string argument. Either way it is
// sent as the X-Audit-Log-Reason header and never in the JSON body.

const GUILD = "100000000000000001";
const ID = "100000000000000002";
const USER = "100000000000000003";

// A superset of the fields the structures read, so every manager can build its result.
const resource = {
    id: ID,
    name: "x",
    type: 0,
    guild_id: GUILD,
    permissions: "0",
    color: 0,
    position: 0,
    hoist: false,
    managed: false,
    mentionable: false,
    roles: [],
    user: { id: USER, username: "u" },
    joined_at: "2024-01-01T00:00:00.000Z",
    channel_id: ID,
    topic: "t",
    privacy_level: 2,
};

function setup() {
    const calls: {
        method: string;
        path: string;
        reason: string | null;
        body: unknown;
    }[] = [];
    const rest = new REST({
        token: "token",
        transport: new HttpTransport({
            fetch: async (url, init) => {
                const headers = new Headers(init?.headers);
                const reason = headers.get("X-Audit-Log-Reason");
                calls.push({
                    method: init?.method ?? "GET",
                    path: new URL(url).pathname.replace("/api/v10", ""),
                    reason: reason === null ? null : decodeURIComponent(reason),
                    body:
                        typeof init?.body === "string"
                            ? JSON.parse(init.body)
                            : null,
                });
                if (init?.method === "DELETE" || init?.method === "PUT")
                    return new Response(null, { status: 204 });
                // Role positions answer with the whole role list.
                const body =
                    init?.method === "PATCH" && url.endsWith("/roles")
                        ? [resource]
                        : resource;
                return new Response(JSON.stringify(body), {
                    status: 200,
                    headers: { "content-type": "application/json" },
                });
            },
        }),
    });
    return {
        calls,
        guilds: new GuildManager(rest),
        channels: new ChannelManager(rest, { messageCache: {} }),
    };
}

function expectReason(
    call: { reason: string | null; body: unknown },
    reason: string,
) {
    expect(call.reason).toBe(reason);
    expect((call.body as Record<string, unknown>)?.reason).toBeUndefined();
}

describe("audit-log reasons", () => {
    test("removing things takes the reason as the last argument", async () => {
        const { calls, guilds, channels } = setup();
        await guilds.roles(GUILD).remove(ID, "role spam");
        await guilds.emojis(GUILD).remove(ID, "emoji spam");
        await channels.remove(ID, "channel spam");
        await guilds.members(GUILD).unban(USER, "appeal accepted");
        await guilds.scheduledEvents(GUILD).remove(ID, "cancelled");
        await guilds.deleteAutoModerationRule(GUILD, ID, "rule retired");
        expect(calls.map((c) => [c.method, c.reason])).toEqual([
            ["DELETE", "role spam"],
            ["DELETE", "emoji spam"],
            ["DELETE", "channel spam"],
            ["DELETE", "appeal accepted"],
            ["DELETE", "cancelled"],
            ["DELETE", "rule retired"],
        ]);
    });

    test("create and edit take the reason in the options object", async () => {
        const { calls, guilds, channels } = setup();
        await guilds.emojis(GUILD).create({
            name: "x",
            image: "data:image/png;base64,AA==",
            reason: "new emoji",
        });
        await guilds.emojis(GUILD).edit(ID, { name: "y", reason: "rename" });
        await channels.create(GUILD, { name: "x", type: 0, reason: "new" });
        await channels.edit(ID, { name: "y", reason: "tidy" });
        await guilds.edit(GUILD, { name: "g", reason: "rebrand" });
        await guilds.members(GUILD).edit(USER, { nick: "n", reason: "nick" });
        await guilds.createAutoModerationRule(GUILD, {
            name: "r",
            reason: "add rule",
        });
        await guilds.editAutoModerationRule(GUILD, ID, {
            name: "r2",
            reason: "edit rule",
        });
        await guilds
            .scheduledEvents(GUILD)
            .create({ name: "e", reason: "event" });
        await guilds
            .scheduledEvents(GUILD)
            .edit(ID, { name: "e2", reason: "move event" });
        const reasons = [
            "new emoji",
            "rename",
            "new",
            "tidy",
            "rebrand",
            "nick",
            "add rule",
            "edit rule",
            "event",
            "move event",
        ];
        expect(calls).toHaveLength(reasons.length);
        calls.forEach((call, i) => expectReason(call, reasons[i]!));
    });

    test("role create and edit send their reason (they used to drop it)", async () => {
        const { calls, guilds } = setup();
        await guilds.roles(GUILD).create({ name: "mods", reason: "new team" });
        await guilds
            .roles(GUILD)
            .edit(ID, { name: "admins", reason: "rename" });
        expectReason(calls[0]!, "new team");
        expectReason(calls[1]!, "rename");
        expect((calls[0]!.body as { name?: string }).name).toBe("mods");
    });

    test("messages, pins, role positions and webhooks take a reason", async () => {
        const { calls, guilds, channels } = setup();
        const second = "100000000000000009";
        const recent = String((BigInt(Date.now() - 1420070400000) << 22n) | 1n);
        await channels.deleteMessage(ID, second, "spam");
        await channels.bulkDeleteMessages(
            ID,
            [recent, `${BigInt(recent) + 1n}`],
            "raid",
        );
        await channels.pinMessage(ID, second, "pin it");
        await channels.unpinMessage(ID, second, "unpin it");
        const roles = await guilds
            .roles(GUILD)
            .setPositions([{ id: ID, position: 3 }], "reorder");
        const webhook = await channels.createWebhook(ID, {
            name: "logs",
            reason: "logging",
        });
        expect(calls.map((c) => [c.method, c.path, c.reason])).toEqual([
            ["DELETE", `/channels/${ID}/messages/${second}`, "spam"],
            ["POST", `/channels/${ID}/messages/bulk-delete`, "raid"],
            ["PUT", `/channels/${ID}/messages/pins/${second}`, "pin it"],
            ["DELETE", `/channels/${ID}/messages/pins/${second}`, "unpin it"],
            ["PATCH", `/guilds/${GUILD}/roles`, "reorder"],
            ["POST", `/channels/${ID}/webhooks`, "logging"],
        ]);
        expect(calls[4]!.body).toEqual([{ id: ID, position: 3 }]);
        expect(calls[5]!.body).toEqual({ name: "logs" });
        expect(roles.map((role) => role.id)).toEqual([ID]);
        expect(webhook.id).toBe(ID);
    });
});
