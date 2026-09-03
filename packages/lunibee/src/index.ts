// ─── Lunibee main re-export barrel ────────────────────────────────────────────
// Aggregates all workspace packages into a single public API surface.
// Where the same name is exported from multiple packages, the more specific
// (builders > types) definition takes precedence via explicit re-export.

export * from "@lunibee/core";
export * from "@lunibee/collection";
export * from "@lunibee/formatters";
export * from "@lunibee/handlers";
export * from "@lunibee/managers";
export * from "@lunibee/rest";
export * from "@lunibee/sharding";
export * from "@lunibee/structures";
export * from "@lunibee/utils";
export * from "@lunibee/voice";
export * from "@lunibee/ws";

// ── Types (explicit to avoid conflicts with builders) ──────────────────────────
// Export types, but skip names that conflict with @lunibee/builders definitions.
export type {
    Snowflake,
    GatewayIntentResolvable,
    GatewayProperties,
    GatewayPresenceActivity,
    GatewayPresence,
    ClientOptions,
    RESTOptions,
    UserData,
    ClientUser,
    GatewayPayload,
    APIError,
    APIEmbedFooter,
    APIEmbedMedia,
    APIEmbedProvider,
    APIEmbedAuthor,
    APIEmbedField,
    APIEmbed,
    APISelectMenuOption,
    APIPartialEmoji,
    APIButtonComponent,
    APISelectMenuComponent,
    APITextInputComponent,
    APIMessageActionRowComponent,
    APIActionRowComponent,
    APIMessageComponent,
    APIAttachment,
    APIStickerItem,
    APISticker,
    APIMessageReference,
    APIMessageReaction,
    APIMessage,
    APIChannel,
    APIThreadMetadata,
    APIForumTag,
    APIThreadMember,
    APIRole,
    APIEmoji,
    APIGuild,
    APIGuildMember,
    APIVoiceState,
    APIVoiceServerUpdate,
    APIActivity,
    APIPresenceUpdate,
    APITypingStart,
    APIInviteCreate,
    APIInviteDelete,
    APIWebhooksUpdate,
    APIWebhook,
    APIAutoModerationAction,
    APIAutoModerationRule,
    APIAutoModerationActionExecution,
    APIGuildScheduledEventEntityMetadata,
    APIGuildScheduledEvent,
    APIStageInstance,
    APIApplicationCommandOption,
    APIApplicationCommand,
    ApplicationCommandData,
    APIReadyEvent,
    APIMessageReactionEvent,
    APIMessageReactionRemoveEmojiEvent,
    APIMessageDeleteEvent,
    APIMessageDeleteBulkEvent,
    APIChannelDeleteEvent,
    APIGuildDeleteEvent,
    APIThreadEvent,
    APIThreadListSync,
    APIThreadMembersUpdate,
    APIGuildRoleEvent,
    APIGuildRoleDeleteEvent,
    APIGuildBanEvent,
    APIGuildEmojisUpdateEvent,
    APIGuildStickersUpdateEvent,
    APIChannelPinsUpdate,
    APIGuildMembersChunk,
    APIGuildScheduledEventUserEvent,
    APIMessagePollVoteEvent,
} from "@lunibee/types";

// Non-conflicting value exports from @lunibee/types
export {
    GatewayIntentBits,
    IntentBits,
    Intents,
    resolveGatewayIntents,
    MessageFlags,
    ChannelType,
    ApplicationCommandOptionType,
    ApplicationCommandType,
    StickerFormatType,
    StickerType,
    VerificationLevel,
    PremiumTier,
} from "@lunibee/types";

// ── Builders (takes priority over types for component enums) ──────────────────
export * from "@lunibee/builders";

// Explicit re-exports for TypeScript consumer clarity
export {
    CommandInteraction,
    ComponentInteraction,
    ModalSubmitInteraction,
    AutocompleteInteraction,
    Interaction,
    GuildMember,
    Role,
    TextChannel,
    Message,
    Embed,
    Webhook,
    AuditLog,
    AuditLogEntry,
} from "@lunibee/structures";

export {
    EmbedBuilder,
    SlashCommandBuilder,
    ButtonBuilder,
    ButtonStyle,
    StringSelectBuilder,
    EntitySelectBuilder,
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle,
    ActionRowBuilder,
    AttachmentBuilder,
} from "@lunibee/builders";

export { Gateway } from "@lunibee/ws";
export type { GatewayOptions } from "@lunibee/ws";
export { Collection, Cache } from "@lunibee/collection";

export {
    REST,
    RESTError,
    Routes,
    WebhookClient,
    type WebhookClientOptions,
    type WebhookMessageOptions,
} from "@lunibee/rest";
