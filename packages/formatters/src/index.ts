/** Creates a Discord user mention. */
export function userMention(id: string): string { return `<@${id}>`; }
/** Creates a Discord channel mention. */
export function channelMention(id: string): string { return `<#${id}>`; }
/** Creates a Discord role mention. */
export function roleMention(id: string): string { return `<@&${id}>`; }
/** Creates a Discord timestamp tag. */
export function timestamp(unixSeconds: number, style?: string): string { return `<t:${Math.floor(unixSeconds)}${style ? `:${style}` : ""}>`; }
/** Escapes Discord markdown control characters. */
export function escapeMarkdown(value: string): string { return value.replace(/[\\*_`~|>]/g, "\\$&"); }
