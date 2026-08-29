/** Type-safe Discord REST route builders. */
export const Routes = {
    /** Returns the current bot user. */
    user: () => "/users/@me",
    /** Returns a user by ID. */
    userById: (userId: string) => `/users/${snowflake(userId, "User ID")}`,
    /** Returns a guild by ID. */
    guild: (guildId: string) => `/guilds/${snowflake(guildId, "Guild ID")}`,
    /** Returns channels for a guild. */
    guildChannels: (guildId: string) => `/guilds/${snowflake(guildId, "Guild ID")}/channels`,
    /** Returns a guild member. */
    guildMember: (guildId: string, userId: string) => `/guilds/${snowflake(guildId, "Guild ID")}/members/${snowflake(userId, "User ID")}`,
    /** Returns all guild roles. */
    guildRoles: (guildId: string) => `/guilds/${snowflake(guildId, "Guild ID")}/roles`,
    /** Returns a channel. */
    channel: (channelId: string) => `/channels/${snowflake(channelId, "Channel ID")}`,
    /** Returns messages in a channel. */
    channelMessages: (channelId: string) => `/channels/${snowflake(channelId, "Channel ID")}/messages`,
    /** Returns a message. */
    message: (channelId: string, messageId: string) => `/channels/${snowflake(channelId, "Channel ID")}/messages/${snowflake(messageId, "Message ID")}`,
    /** Returns a webhook. */
    webhook: (webhookId: string, token?: string) => `/webhooks/${snowflake(webhookId, "Webhook ID")}${token ? `/${encodeURIComponent(token)}` : ""}`,
    /** Returns application commands for an application. */
    applicationCommands: (applicationId: string) => `/applications/${snowflake(applicationId, "Application ID")}/commands`,
    /** Returns one application command. */
    applicationCommand: (applicationId: string, commandId: string) => `/applications/${snowflake(applicationId, "Application ID")}/commands/${snowflake(commandId, "Command ID")}`,
    /** Returns guild application commands. */
    guildApplicationCommands: (applicationId: string, guildId: string) => `/applications/${snowflake(applicationId, "Application ID")}/guilds/${snowflake(guildId, "Guild ID")}/commands`
} as const;

function snowflake(value: string, field: string): string {
    if (!/^\d{1,20}$/.test(value)) throw new TypeError(`${field} must be a valid Discord snowflake.`);
    return value;
}
