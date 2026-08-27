/** Type-safe Discord REST route builders. */
export const Routes = {
    /** Returns the current bot user. */
    user: () => "/users/@me",
    /** Returns a user by ID. */
    userById: (userId: string) => `/users/${userId}`,
    /** Returns a guild by ID. */
    guild: (guildId: string) => `/guilds/${guildId}`,
    /** Returns channels for a guild. */
    guildChannels: (guildId: string) => `/guilds/${guildId}/channels`,
    /** Returns a guild member. */
    guildMember: (guildId: string, userId: string) => `/guilds/${guildId}/members/${userId}`,
    /** Returns all guild roles. */
    guildRoles: (guildId: string) => `/guilds/${guildId}/roles`,
    /** Returns a channel. */
    channel: (channelId: string) => `/channels/${channelId}`,
    /** Returns messages in a channel. */
    channelMessages: (channelId: string) => `/channels/${channelId}/messages`,
    /** Returns a message. */
    message: (channelId: string, messageId: string) => `/channels/${channelId}/messages/${messageId}`,
    /** Returns a webhook. */
    webhook: (webhookId: string, token?: string) => `/webhooks/${webhookId}${token ? `/${token}` : ""}`,
    /** Returns application commands for an application. */
    applicationCommands: (applicationId: string) => `/applications/${applicationId}/commands`,
    /** Returns one application command. */
    applicationCommand: (applicationId: string, commandId: string) => `/applications/${applicationId}/commands/${commandId}`,
    /** Returns guild application commands. */
    guildApplicationCommands: (applicationId: string, guildId: string) => `/applications/${applicationId}/guilds/${guildId}/commands`
} as const;
