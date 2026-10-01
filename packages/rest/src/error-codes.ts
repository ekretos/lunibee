/**
 * Discord JSON error codes that bots commonly handle, by name, for comparing
 * with `RESTError.code`: `if (error.code === RESTErrorCode.UnknownMessage) …`.
 *
 * Values are from Discord's "JSON Error Codes" table
 * (discord/discord-api-docs, developers/topics/opcodes-and-status-codes.mdx,
 * checked at commit 86f0a46). Any other code is still available as a number
 * on `RESTError.code`.
 */
export const RESTErrorCode = {
    UnknownAccount: 10001,
    UnknownChannel: 10003,
    UnknownGuild: 10004,
    UnknownInvite: 10006,
    UnknownMember: 10007,
    UnknownMessage: 10008,
    UnknownPermissionOverwrite: 10009,
    UnknownRole: 10011,
    UnknownUser: 10013,
    UnknownEmoji: 10014,
    UnknownWebhook: 10015,
    UnknownBan: 10026,
    UnknownSticker: 10060,
    UnknownInteraction: 10062,
    UnknownScheduledEvent: 10070,
    BotsCannotUseEndpoint: 20001,
    MaxGuilds: 30001,
    MaxPins: 30003,
    MaxRoles: 30005,
    MaxWebhooks: 30007,
    MaxEmojis: 30008,
    MaxReactions: 30010,
    MaxChannels: 30013,
    InteractionAlreadyAcknowledged: 40060,
    MissingAccess: 50001,
    CannotExecuteInDM: 50003,
    CannotEditOthersMessage: 50005,
    CannotSendEmptyMessage: 50006,
    CannotSendMessagesToUser: 50007,
    MissingPermissions: 50013,
    InvalidToken: 50014,
    MessageTooOldToBulkDelete: 50034,
    InvalidFormBody: 50035,
    ThreadArchived: 50083,
    CannotReplyWithoutReadHistory: 160002,
} as const;
/** One {@link RESTErrorCode} value, usable as a type. */
export type RESTErrorCode = (typeof RESTErrorCode)[keyof typeof RESTErrorCode];
