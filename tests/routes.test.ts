import { describe, expect, test } from "bun:test";
import { Routes } from "../packages/rest/src/routes.ts";

// Discord snowflakes are 17-19 digits and `Routes` rejects anything else, so
// route tests must use realistically shaped identifiers.
const A = "123456789012345678";
const B = "223456789012345678";
const C = "323456789012345678";

describe("REST Routes Full Coverage", () => {
    test("all routes produce valid endpoint strings", () => {
        expect(Routes.user()).toBe("/users/@me");
        expect(Routes.userById(A)).toBe(`/users/${A}`);
        expect(Routes.guild(A)).toBe(`/guilds/${A}`);
        expect(Routes.guildChannels(A)).toBe(`/guilds/${A}/channels`);
        expect(Routes.guildMember(A, B)).toBe(`/guilds/${A}/members/${B}`);
        expect(Routes.guildRoles(A)).toBe(`/guilds/${A}/roles`);
        expect(Routes.guildRole(A, C)).toBe(`/guilds/${A}/roles/${C}`);
        expect(Routes.guildMemberRole(A, B, C)).toBe(
            `/guilds/${A}/members/${B}/roles/${C}`,
        );
        expect(Routes.guildBans(A)).toBe(`/guilds/${A}/bans`);
        expect(Routes.guildBan(A, B)).toBe(`/guilds/${A}/bans/${B}`);
        expect(Routes.channel(A)).toBe(`/channels/${A}`);
        expect(Routes.channelMessages(A)).toBe(`/channels/${A}/messages`);
        expect(Routes.message(A, B)).toBe(`/channels/${A}/messages/${B}`);
        expect(Routes.crosspostMessage(A, B)).toBe(
            `/channels/${A}/messages/${B}/crosspost`,
        );
        expect(Routes.messageReactions(A, B, "👍")).toBe(
            `/channels/${A}/messages/${B}/reactions/%F0%9F%91%8D`,
        );
        expect(Routes.messageReactionsAll(A, B)).toBe(
            `/channels/${A}/messages/${B}/reactions`,
        );
        expect(Routes.channelPins(A)).toBe(`/channels/${A}/pins`);
        expect(Routes.channelPin(A, B)).toBe(`/channels/${A}/pins/${B}`);
        expect(Routes.messageThread(A, B)).toBe(
            `/channels/${A}/messages/${B}/threads`,
        );
        expect(Routes.channelBulkDelete(A)).toBe(
            `/channels/${A}/messages/bulk-delete`,
        );
        expect(Routes.channelWebhooks(A)).toBe(`/channels/${A}/webhooks`);
        expect(Routes.channelInvites(A)).toBe(`/channels/${A}/invites`);
        expect(Routes.webhook(A, "token")).toBe(`/webhooks/${A}/token`);
        expect(Routes.webhookMessage(A, "token", B)).toBe(
            `/webhooks/${A}/token/messages/${B}`,
        );
        expect(Routes.applicationCommands(A)).toBe(
            `/applications/${A}/commands`,
        );
        expect(Routes.applicationCommand(A, B)).toBe(
            `/applications/${A}/commands/${B}`,
        );
        expect(Routes.guildApplicationCommands(A, B)).toBe(
            `/applications/${A}/guilds/${B}/commands`,
        );
        expect(Routes.interactionCallback(A, "token")).toBe(
            `/interactions/${A}/token/callback`,
        );
        expect(Routes.interactionOriginalResponse(A, "token")).toBe(
            `/webhooks/${A}/token/messages/@original`,
        );
        expect(Routes.guildActiveThreads(A)).toBe(
            `/guilds/${A}/threads/active`,
        );
        expect(Routes.channelPublicArchivedThreads(A)).toBe(
            `/channels/${A}/threads/archived/public`,
        );
        expect(Routes.channelPrivateArchivedThreads(A)).toBe(
            `/channels/${A}/threads/archived/private`,
        );
        expect(Routes.threadMembers(A)).toBe(`/channels/${A}/thread-members`);
        expect(Routes.guildScheduledEvents(A)).toBe(
            `/guilds/${A}/scheduled-events`,
        );
        expect(Routes.guildScheduledEvent(A, B)).toBe(
            `/guilds/${A}/scheduled-events/${B}`,
        );
        expect(Routes.guildAutoModerationRules(A)).toBe(
            `/guilds/${A}/auto-moderation/rules`,
        );
        expect(Routes.guildAutoModerationRule(A, B)).toBe(
            `/guilds/${A}/auto-moderation/rules/${B}`,
        );
        expect(Routes.voiceRegions()).toBe("/voice/regions");
        expect(Routes.gateway()).toBe("/gateway");
        expect(Routes.gatewayBot()).toBe("/gateway/bot");
    });

    test("throws TypeError for invalid snowflake parameters", () => {
        expect(() => Routes.guild("invalid_id")).toThrow(TypeError);
        expect(() => Routes.channel("abc")).toThrow(TypeError);
    });
});
