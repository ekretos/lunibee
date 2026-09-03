/**
 * Structure hydration compatibility. Structures map raw Discord snake_case gateway/REST
 * payloads onto discord.js-familiar camelCase properties with discord.js nullability
 * semantics (e.g. legacy "0" discriminator → null, missing avatar → null).
 */
import { describe, expect, test } from "bun:test";
import { User, Message, Channel } from "@lunibee/structures";

const ID = "123456789012345678";

describe("User hydration", () => {
    test("maps snake_case payload keys to camelCase properties", () => {
        const u = new User({
            id: ID,
            username: "wumpus",
            global_name: "Wumpus",
            avatar: "abc",
            public_flags: 64,
            bot: true,
        } as never);
        expect(u.id).toBe(ID);
        expect(u.username).toBe("wumpus");
        expect(u.globalName).toBe("Wumpus");
        expect(u.flags).toBe(64);
        expect(u.bot).toBe(true);
        expect(u.system).toBe(false);
    });
    test("displayName falls back to username when no global name", () => {
        const u = new User({ id: ID, username: "wumpus" } as never);
        expect(u.globalName).toBeNull();
        expect(u.displayName).toBe("wumpus");
    });
    test("legacy '0' discriminator normalizes to null (discord.js parity)", () => {
        const u = new User({
            id: ID,
            username: "x",
            discriminator: "0",
        } as never);
        expect(u.discriminator).toBeNull();
    });
    test("avatarURL is null without an avatar; toString is a mention", () => {
        const u = new User({ id: ID, username: "x" } as never);
        expect(u.avatarURL()).toBeNull();
        expect(`${u}`).toBe(`<@${ID}>`);
    });
});

describe("Message hydration", () => {
    const base = {
        id: ID,
        channel_id: ID,
        author: { id: "999", username: "author" },
    };
    test("core fields map with discord.js-familiar names", () => {
        const m = new Message({
            ...base,
            content: "hello",
            mention_everyone: true,
            mention_roles: ["1", "2"],
        } as never);
        expect(m.content).toBe("hello");
        expect(m.author).toBeInstanceOf(User);
        expect(m.channelId).toBe(ID);
        expect(m.mentionEveryone).toBe(true);
        expect(m.mentionRoles).toEqual(["1", "2"]);
    });
    test("content defaults to empty string when omitted", () => {
        const m = new Message(base as never);
        expect(m.content).toBe("");
    });
    test("timestamp is a Date", () => {
        const m = new Message({
            ...base,
            timestamp: "2024-01-01T00:00:00.000Z",
        } as never);
        expect(m.timestamp).toBeInstanceOf(Date);
        expect(m.timestamp.toISOString()).toBe("2024-01-01T00:00:00.000Z");
    });
    test("carries discord.js-style helper methods", () => {
        const m = new Message(base as never);
        expect(typeof m.reply).toBe("function");
        expect(typeof m.react).toBe("function");
        expect(typeof m.pin).toBe("function");
    });
    // discord.js exposes message.createdTimestamp (number) and message.createdAt (Date).
    // Lunibee exposes only `timestamp` (Date); the createdTimestamp accessor is missing.
    test.failing("exposes discord.js createdTimestamp accessor", () => {
        const m = new Message({
            ...base,
            timestamp: "2024-01-01T00:00:00.000Z",
        } as never);
        expect((m as unknown as { createdTimestamp: number }).createdTimestamp).toBe(
            Date.parse("2024-01-01T00:00:00.000Z"),
        );
    });
});

describe("Channel hydration", () => {
    test("maps type/name/guild_id and renders a channel mention", () => {
        const c = new Channel({
            id: ID,
            type: 0,
            name: "general",
            guild_id: "42",
        } as never);
        expect(c.type).toBe(0);
        expect(c.name).toBe("general");
        expect(c.guildId).toBe("42");
        expect(`${c}`).toBe(`<#${ID}>`);
    });
    test("rejects an invalid channel type", () => {
        expect(() => new Channel({ id: ID, type: -1 } as never)).toThrow(
            RangeError,
        );
    });
});

describe("BaseStructure snowflake validation", () => {
    test("rejects a non-snowflake id", () => {
        expect(() => new User({ id: "nope", username: "x" } as never)).toThrow();
    });
});
