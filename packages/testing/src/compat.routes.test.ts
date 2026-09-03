/**
 * REST route wire-compatibility. Route *names* follow Lunibee conventions and are
 * intentionally allowed to differ from discord.js/discord-api-types, but the *paths*
 * they produce are sent to Discord's REST API and MUST match Discord's documented
 * endpoints exactly (leading slash, snowflake segments, sub-resource spelling).
 */
import { describe, expect, test } from "bun:test";
import { Routes } from "@lunibee/rest";

const CH = "123456789012345678";
const MSG = "223456789012345678";
const GUILD = "323456789012345678";
const USER = "423456789012345678";
const APP = "523456789012345678";
const ROLE = "623456789012345678";

describe("User & guild routes", () => {
    test("current user and user-by-id", () => {
        expect(Routes.user()).toBe("/users/@me");
        expect(Routes.userById(USER)).toBe(`/users/${USER}`);
    });
    test("guild core routes", () => {
        expect(Routes.guild(GUILD)).toBe(`/guilds/${GUILD}`);
        expect(Routes.guildChannels(GUILD)).toBe(`/guilds/${GUILD}/channels`);
        expect(Routes.guildRoles(GUILD)).toBe(`/guilds/${GUILD}/roles`);
        expect(Routes.guildRole(GUILD, ROLE)).toBe(
            `/guilds/${GUILD}/roles/${ROLE}`,
        );
        expect(Routes.guildMember(GUILD, USER)).toBe(
            `/guilds/${GUILD}/members/${USER}`,
        );
        expect(Routes.guildBan(GUILD, USER)).toBe(
            `/guilds/${GUILD}/bans/${USER}`,
        );
    });
});

describe("Channel & message routes", () => {
    test("channel, messages, single message", () => {
        expect(Routes.channel(CH)).toBe(`/channels/${CH}`);
        expect(Routes.channelMessages(CH)).toBe(`/channels/${CH}/messages`);
        expect(Routes.message(CH, MSG)).toBe(
            `/channels/${CH}/messages/${MSG}`,
        );
    });
    test("reactions encode the emoji segment", () => {
        expect(Routes.messageReactions(CH, MSG, "👍")).toBe(
            `/channels/${CH}/messages/${MSG}/reactions/${encodeURIComponent("👍")}`,
        );
        expect(Routes.messageReactionsAll(CH, MSG)).toBe(
            `/channels/${CH}/messages/${MSG}/reactions`,
        );
    });
    test("bulk delete + pins use Discord's exact sub-paths", () => {
        expect(Routes.channelBulkDelete(CH)).toBe(
            `/channels/${CH}/messages/bulk-delete`,
        );
        expect(Routes.channelPins(CH)).toBe(`/channels/${CH}/pins`);
        expect(Routes.channelPin(CH, MSG)).toBe(`/channels/${CH}/pins/${MSG}`);
    });
});

describe("Application command & interaction routes", () => {
    test("global and guild command collections", () => {
        expect(Routes.applicationCommands(APP)).toBe(
            `/applications/${APP}/commands`,
        );
        expect(Routes.guildApplicationCommands(APP, GUILD)).toBe(
            `/applications/${APP}/guilds/${GUILD}/commands`,
        );
    });
    test("interaction callback + original response", () => {
        expect(Routes.interactionCallback("999", "tok")).toBe(
            "/interactions/999/tok/callback",
        );
        expect(Routes.interactionOriginalResponse(APP, "tok")).toBe(
            `/webhooks/${APP}/tok/messages/@original`,
        );
    });
});

describe("Route input validation", () => {
    test("rejects a non-snowflake id", () => {
        expect(() => Routes.guild("not-a-snowflake")).toThrow();
    });
});
