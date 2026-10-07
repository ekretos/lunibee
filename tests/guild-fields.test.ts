import { expect, test } from "bun:test";
import type { APIGuild } from "../packages/types/src/index.ts";
import { Guild } from "../packages/structures/src/index.ts";

// Every APIGuild field is either a Guild property or deliberately left out.
// Adding a field to APIGuild breaks this file until it is mapped or excluded.
const mapping: Record<keyof APIGuild, keyof Guild | null> = {
    id: "id",
    name: "name",
    icon: "icon",
    splash: "splash",
    discovery_splash: "discoverySplash",
    owner_id: "ownerId",
    afk_channel_id: "afkChannelId",
    afk_timeout: "afkTimeout",
    widget_enabled: "widgetEnabled",
    widget_channel_id: "widgetChannelId",
    verification_level: "verificationLevel",
    default_message_notifications: "defaultMessageNotifications",
    explicit_content_filter: "explicitContentFilter",
    features: "features",
    mfa_level: "mfaLevel",
    application_id: "applicationId",
    system_channel_id: "systemChannelId",
    system_channel_flags: "systemChannelFlags",
    rules_channel_id: "rulesChannelId",
    max_presences: "maxPresences",
    max_members: "maxMembers",
    vanity_url_code: "vanityUrlCode",
    description: "description",
    banner: "banner",
    premium_tier: "premiumTier",
    premium_subscription_count: "premiumSubscriptionCount",
    preferred_locale: "preferredLocale",
    public_updates_channel_id: "publicUpdatesChannelId",
    max_video_channel_users: "maxVideoChannelUsers",
    premium_progress_bar_enabled: "premiumProgressBarEnabled",
    approximate_member_count: "approximateMemberCount",
    approximate_presence_count: "approximatePresenceCount",
    nsfw_level: "nsfwLevel",
    safety_alerts_channel_id: "safetyAlertsChannelId",
    member_count: "memberCount",
    // Cached by the role, emoji and sticker managers, not on the structure.
    roles: null,
    emojis: null,
    stickers: null,
    // Only in the current user's guild list (OAuth), never for a bot's guilds.
    owner: null,
    permissions: null,
    // Only in guild templates.
    icon_hash: null,
};

const full: Required<APIGuild> = {
    id: "100000000000000001",
    name: "Hive",
    icon: "a",
    icon_hash: "b",
    splash: "c",
    discovery_splash: "d",
    owner: false,
    owner_id: "100000000000000002",
    permissions: "0",
    afk_channel_id: "100000000000000003",
    afk_timeout: 300,
    widget_enabled: true,
    widget_channel_id: "100000000000000004",
    verification_level: 2,
    default_message_notifications: 1,
    explicit_content_filter: 2,
    roles: [],
    emojis: [],
    stickers: [],
    features: ["COMMUNITY"],
    mfa_level: 1,
    application_id: "100000000000000005",
    system_channel_id: "100000000000000006",
    system_channel_flags: 4,
    rules_channel_id: "100000000000000007",
    max_presences: 25000,
    max_members: 500000,
    vanity_url_code: "hive",
    description: "Bees",
    banner: "e",
    premium_tier: 3,
    premium_subscription_count: 14,
    preferred_locale: "en-GB",
    public_updates_channel_id: "100000000000000008",
    max_video_channel_users: 25,
    premium_progress_bar_enabled: true,
    approximate_member_count: 90,
    approximate_presence_count: 40,
    nsfw_level: 0,
    safety_alerts_channel_id: "100000000000000009",
    member_count: 100,
};

test("every APIGuild field is mapped onto Guild or deliberately excluded", () => {
    const guild = new Guild(full);
    for (const [key, property] of Object.entries(mapping)) {
        if (property === null) continue;
        const actual: unknown = guild[property];
        const expected: unknown = full[key as keyof APIGuild];
        expect([key, actual]).toEqual([key, expected]);
    }
});

test("missing optional guild fields get safe defaults", () => {
    const guild = new Guild({ id: "100000000000000001", name: "Hive" });
    expect(guild.afkChannelId).toBeNull();
    expect(guild.afkTimeout).toBeUndefined();
    expect(guild.widgetEnabled).toBe(false);
    expect(guild.maxPresences).toBeNull();
    expect(guild.applicationId).toBeNull();
});
