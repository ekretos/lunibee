import { describe, expect, test } from "bun:test";
import { Routes } from "../packages/rest/src/routes.ts";

describe("REST Routes Full Coverage", () => {
  test("all routes produce valid endpoint strings", () => {
    expect(Routes.user()).toBe("/users/@me");
    expect(Routes.userById("123")).toBe("/users/123");
    expect(Routes.guild("123")).toBe("/guilds/123");
    expect(Routes.guildChannels("123")).toBe("/guilds/123/channels");
    expect(Routes.guildMember("123", "456")).toBe("/guilds/123/members/456");
    expect(Routes.guildRoles("123")).toBe("/guilds/123/roles");
    expect(Routes.guildRole("123", "789")).toBe("/guilds/123/roles/789");
    expect(Routes.guildMemberRole("123", "456", "789")).toBe(
      "/guilds/123/members/456/roles/789",
    );
    expect(Routes.guildBans("123")).toBe("/guilds/123/bans");
    expect(Routes.guildBan("123", "456")).toBe("/guilds/123/bans/456");
    expect(Routes.channel("123")).toBe("/channels/123");
    expect(Routes.channelMessages("123")).toBe("/channels/123/messages");
    expect(Routes.message("123", "456")).toBe("/channels/123/messages/456");
    expect(Routes.crosspostMessage("123", "456")).toBe(
      "/channels/123/messages/456/crosspost",
    );
    expect(Routes.messageReactions("123", "456", "👍")).toBe(
      "/channels/123/messages/456/reactions/%F0%9F%91%8D",
    );
    expect(Routes.messageReactionsAll("123", "456")).toBe(
      "/channels/123/messages/456/reactions",
    );
    expect(Routes.channelPins("123")).toBe("/channels/123/pins");
    expect(Routes.channelPin("123", "456")).toBe(
      "/channels/123/messages/456/pins",
    );
    expect(Routes.messageThread("123", "456")).toBe(
      "/channels/123/messages/456/threads",
    );
    expect(Routes.channelBulkDelete("123")).toBe(
      "/channels/123/messages/bulk-delete",
    );
    expect(Routes.channelWebhooks("123")).toBe("/channels/123/webhooks");
    expect(Routes.channelInvites("123")).toBe("/channels/123/invites");
    expect(Routes.webhook("123", "token")).toBe("/webhooks/123/token");
    expect(Routes.webhookMessage("123", "token", "456")).toBe(
      "/webhooks/123/token/messages/456",
    );
    expect(Routes.applicationCommands("123")).toBe(
      "/applications/123/commands",
    );
    expect(Routes.applicationCommand("123", "456")).toBe(
      "/applications/123/commands/456",
    );
    expect(Routes.guildApplicationCommands("123", "456")).toBe(
      "/applications/123/guilds/456/commands",
    );
    expect(Routes.interactionCallback("123", "token")).toBe(
      "/interactions/123/token/callback",
    );
    expect(Routes.interactionOriginalResponse("123", "token")).toBe(
      "/webhooks/123/token/messages/@original",
    );
    expect(Routes.guildActiveThreads("123")).toBe("/guilds/123/threads/active");
    expect(Routes.channelPublicArchivedThreads("123")).toBe(
      "/channels/123/threads/archived/public",
    );
    expect(Routes.channelPrivateArchivedThreads("123")).toBe(
      "/channels/123/threads/archived/private",
    );
    expect(Routes.threadMembers("123")).toBe("/channels/123/thread-members");
    expect(Routes.guildScheduledEvents("123")).toBe(
      "/guilds/123/scheduled-events",
    );
    expect(Routes.guildScheduledEvent("123", "456")).toBe(
      "/guilds/123/scheduled-events/456",
    );
    expect(Routes.guildAutoModerationRules("123")).toBe(
      "/guilds/123/auto-moderation/rules",
    );
    expect(Routes.guildAutoModerationRule("123", "456")).toBe(
      "/guilds/123/auto-moderation/rules/456",
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
