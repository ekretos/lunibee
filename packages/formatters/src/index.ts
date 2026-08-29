/** Creates a user mention from a Discord snowflake. */
export function userMention(id: string): string {
    return `<@${validateSnowflake(id, "User ID")}>`;
}

/** Creates a channel mention from a Discord snowflake. */
export function channelMention(id: string): string {
    return `<#${validateSnowflake(id, "Channel ID")}>`;
}

/** Creates a role mention from a Discord snowflake. */
export function roleMention(id: string): string {
    return `<@&${validateSnowflake(id, "Role ID")}>`;
}

/** Creates a Discord timestamp tag. */
export function timestamp(unixSeconds: number, style?: string): string {
    if (!Number.isFinite(unixSeconds)) throw new TypeError("Timestamp must be a finite Unix timestamp.");
    if (style !== undefined && !/^[tTdDfFR]$/.test(style)) throw new RangeError("Invalid Discord timestamp style.");
    return `<t:${Math.floor(unixSeconds)}${style ? `:${style}` : ""}>`;
}

/** Escapes Discord markdown control characters. */
export function escapeMarkdown(value: string): string {
    return value.replace(/[\\*_`~|>]/g, "\\$&");
}

function validateSnowflake(id: string, field: string): string {
    if (!/^\d{1,20}$/.test(id)) throw new TypeError(`${field} must be a valid Discord snowflake.`);
    return id;
}
