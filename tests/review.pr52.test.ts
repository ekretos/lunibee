import { describe, expect, test } from "bun:test";
import { Client, Permission } from "../packages/core/src/index.ts";
import { ButtonBuilder, ButtonStyle } from "../packages/builders/src/index.ts";
import { redactPath } from "../packages/rest/src/index.ts";
import type { Message } from "../packages/structures/src/index.ts";

const G = "200000000000000000";
const U = "300000000000000000";
const C = "100000000000000000";
const T = "110000000000000000";
const M = "600000000000000000";

function client(options: Record<string, unknown> = {}) {
    const c = new Client({ token: "a.b", intents: 0, ...options });
    const gw = c.gateway as unknown as {
        emit(event: string, data: unknown): void;
    };
    return { c, gw };
}

const message = (content: string) => ({
    id: M,
    channel_id: C,
    author: { id: U, username: "u" },
    content,
    timestamp: "2020-01-01T00:00:00Z",
});

describe("Gateway messages and messageCache", () => {
    test("cached messages expose the previous version on update and delete", () => {
        const { c, gw } = client({ messageCache: { maxSize: 10 } });
        let created: Message | undefined;
        let updated: [Message, Message | undefined] | undefined;
        let deleted: Message | undefined;
        c.on("messageCreate", (m) => (created = m));
        c.on("messageUpdate", (m, previous) => (updated = [m, previous]));
        c.on("messageDelete", (_d, m) => (deleted = m));
        gw.emit("MESSAGE_CREATE", message("one"));
        expect(c.channels.messages(C).cache.get(M)).toBe(created!);
        gw.emit("MESSAGE_UPDATE", message("two"));
        expect(updated![0].content).toBe("two");
        expect(updated![1]?.content).toBe("one");
        gw.emit("MESSAGE_DELETE", { id: M, channel_id: C });
        expect(deleted?.content).toBe("two");
        expect(c.channels.messages(C).cache.has(M)).toBe(false);
    });

    test("bulk delete reports the cached messages; nothing is cached by default", () => {
        const { c, gw } = client({ messageCache: {} });
        let removed: Message[] = [];
        c.on("messageDeleteBulk", (_d, messages) => (removed = messages));
        gw.emit("MESSAGE_CREATE", message("x"));
        gw.emit("MESSAGE_DELETE_BULK", { ids: [M, "1"], channel_id: C });
        expect(removed.map((m) => m.id)).toEqual([M]);

        const plain = client();
        let previous: Message | undefined = undefined;
        plain.c.on("messageUpdate", (_m, p) => (previous = p));
        plain.gw.emit("MESSAGE_CREATE", message("x"));
        plain.gw.emit("MESSAGE_UPDATE", message("y"));
        expect(previous).toBeUndefined();
        expect(plain.c.channels.cachedMessages(C)).toBeUndefined();
    });
});

describe("button field exclusivity", () => {
    test("premium buttons drop and reject label, emoji, custom ID and URL", () => {
        const premium = new ButtonBuilder().setLabel("Buy").setSKUId("123");
        expect(premium.toJSON()).toEqual({
            type: 2,
            style: ButtonStyle.Premium,
            sku_id: "123",
        });
        premium.setLabel("Buy");
        expect(() => premium.toJSON()).toThrow("Premium buttons cannot");
    });

    test("changing style clears fields the new style cannot carry", () => {
        const button = new ButtonBuilder()
            .setURL("https://example.com")
            .setLabel("Go")
            .setStyle(ButtonStyle.Primary)
            .setCustomId("go");
        expect(button.toJSON().url).toBeUndefined();
        const fromPremium = new ButtonBuilder()
            .setSKUId("1")
            .setStyle(ButtonStyle.Link)
            .setURL("https://example.com")
            .setLabel("x");
        expect(fromPremium.toJSON().sku_id).toBeUndefined();
    });
});

describe("permissions and caching", () => {
    test("owners and administrators get bits 48, 51 and 52", () => {
        const { c, gw } = client();
        gw.emit("GUILD_CREATE", {
            id: G,
            name: "g",
            owner_id: U,
            members: [
                {
                    user: { id: U, username: "u" },
                    roles: [],
                    joined_at: "2020-01-01T00:00:00Z",
                },
            ],
        });
        const perms = c.permissionsFor(U, G)!;
        expect(
            perms.has(
                Permission.setVoiceChannelStatus,
                Permission.pinMessages,
                Permission.bypassSlowmode,
            ),
        ).toBe(true);
    });

    test("GUILD_UPDATE keeps fields the payload omits", () => {
        const { c, gw } = client();
        gw.emit("GUILD_CREATE", { id: G, name: "g", member_count: 42 });
        gw.emit("GUILD_UPDATE", { id: G, name: "g2" });
        expect(c.guilds.get(G)?.name).toBe("g2");
        expect(c.guilds.get(G)?.memberCount).toBe(42);
    });

    test("threads use the parent's overwrites, or return null without it", () => {
        const { c, gw } = client();
        gw.emit("GUILD_CREATE", {
            id: G,
            name: "g",
            owner_id: "1",
            roles: [{ id: G, name: "@everyone", permissions: "1024" }],
            members: [
                {
                    user: { id: U, username: "u" },
                    roles: [],
                    joined_at: "2020-01-01T00:00:00Z",
                },
            ],
            channels: [
                {
                    id: C,
                    type: 0,
                    name: "c",
                    permission_overwrites: [
                        { id: G, type: 0, allow: "0", deny: "1024" },
                    ],
                },
            ],
            threads: [{ id: T, type: 11, name: "t", parent_id: C }],
        });
        expect(c.permissionsFor(U, G)?.has("viewChannel")).toBe(true);
        expect(c.permissionsFor(U, T)?.has("viewChannel")).toBe(false);
        c.channels.delete(C);
        expect(c.permissionsFor(U, T)).toBeNull();
    });
});

describe("token redaction with malformed IDs", () => {
    test("redacts the token even when the ID is not a snowflake", () => {
        expect(redactPath("/webhooks/invalid-id/live-token")).toBe(
            "/webhooks/invalid-id/:token",
        );
        expect(redactPath("/interactions/x/live-token/callback")).toBe(
            "/interactions/x/:token/callback",
        );
    });
});
