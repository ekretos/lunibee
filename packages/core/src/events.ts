/** Common Discord Gateway events exposed by Lunibee. */
export interface DiscordEvents {
    /** Fired when the Gateway session becomes ready. */
    ready: [unknown];
    /** Fired when a message is created. */
    messageCreate: [unknown];
    /** Fired when a message is updated. */
    messageUpdate: [unknown];
    /** Fired when a message is deleted. */
    messageDelete: [unknown];
    /** Fired when a guild becomes available. */
    guildCreate: [unknown];
    /** Fired when a guild is updated. */
    guildUpdate: [unknown];
    /** Fired when a guild becomes unavailable or is removed. */
    guildDelete: [unknown];
    /** Fired when a channel is created. */
    channelCreate: [unknown];
    /** Fired when a channel is updated. */
    channelUpdate: [unknown];
    /** Fired when a channel is deleted. */
    channelDelete: [unknown];
    /** Fired when a guild member is added. */
    guildMemberAdd: [unknown];
    /** Fired when a guild member is updated. */
    guildMemberUpdate: [unknown];
    /** Fired when a guild member is removed. */
    guildMemberRemove: [unknown];
    /** Fired when a role is created. */
    guildRoleCreate: [unknown];
    /** Fired when a role is updated. */
    guildRoleUpdate: [unknown];
    /** Fired when a role is deleted. */
    guildRoleDelete: [unknown];
    /** Fired when an interaction is created. */
    interactionCreate: [unknown];
    /** Fired for an unrecognized or otherwise untyped dispatch. */
    raw: [unknown];
    /** Fired when a transport error occurs. */
    error: [Error];
}
