// ─── Mentions ──────────────────────────────────────────────────────────────────

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

// ─── Timestamps ────────────────────────────────────────────────────────────────

/** Discord timestamp style formats. */
export type TimestampStyle = "t" | "T" | "d" | "D" | "f" | "F" | "R";

/** Creates a Discord timestamp tag.
 * @param unixSeconds Unix timestamp in seconds.
 * @param style Optional display style: t=short time, T=long time, d=short date, D=long date, f=short datetime, F=long datetime, R=relative.
 */
export function timestamp(
    unixSeconds: number,
    style?: TimestampStyle | string,
): string {
    if (!Number.isFinite(unixSeconds))
        throw new TypeError("Timestamp must be a finite Unix timestamp.");
    if (style !== undefined && !/^[tTdDfFR]$/.test(style))
        throw new RangeError("Invalid Discord timestamp style.");
    return `<t:${Math.floor(unixSeconds)}${style ? `:${style}` : ""}>`;
}

// ─── Markdown ─────────────────────────────────────────────────────────────────

/** Wraps text in Discord bold markdown. */
export function bold(text: string): string {
    return `**${text}**`;
}

/** Wraps text in Discord italic markdown. */
export function italic(text: string): string {
    return `_${text}_`;
}

/** Wraps text in Discord underline markdown. */
export function underline(text: string): string {
    return `__${text}__`;
}

/** Wraps text in Discord strikethrough markdown. */
export function strikethrough(text: string): string {
    return `~~${text}~~`;
}

/** Wraps text in a Discord spoiler tag (shown masked until clicked). */
export function spoiler(text: string): string {
    return `||${text}||`;
}

/** Alias for spoiler — hides text until revealed. */
export function masked(text: string): string {
    return spoiler(text);
}

/** Wraps text in Discord inline code. */
export function inlineCode(text: string): string {
    return `\`${text}\``;
}

/** Wraps text in a Discord fenced code block.
 * @param text Code content.
 * @param language Optional language identifier for syntax highlighting.
 */
export function codeBlock(text: string, language = ""): string {
    return `\`\`\`${language}\n${text}\n\`\`\``;
}

/** Creates a Discord masked hyperlink: [label](url).
 * @param label Display text.
 * @param url Destination URL.
 * @param title Optional hover title.
 */
export function link(label: string, url: string, title?: string): string {
    const titlePart = title ? ` "${title}"` : "";
    return `[${label}](${url}${titlePart})`;
}

/** Wraps each line of text in a Discord block quote (> prefix). */
export function blockQuote(text: string): string {
    return text
        .split("\n")
        .map((line) => `> ${line}`)
        .join("\n");
}

/** Creates a Discord heading at the given level (1–3). */
export function heading(text: string, level: 1 | 2 | 3 = 1): string {
    return `${"#".repeat(level)} ${text}`;
}

/** Wraps text in Discord's subtext markdown (-# prefix). */
export function subtext(text: string): string {
    return `-# ${text}`;
}

/** Creates a numbered ordered list from items. */
export function orderedList(...items: string[]): string {
    return items.map((item, i) => `${i + 1}. ${item}`).join("\n");
}

/** Creates an unordered bullet list from items. */
export function bulletList(...items: string[]): string {
    return items.map((item) => `- ${item}`).join("\n");
}

// ─── Utilities ─────────────────────────────────────────────────────────────────

/** Escapes Discord markdown control characters in a string. */
export function escapeMarkdown(value: string): string {
    return value.replace(/[\\*_`~|>]/g, "\\$&");
}

function validateSnowflake(id: string, field: string): string {
    const len = id.length;
    if (len < 1 || len > 20) {
        throw new TypeError(`${field} must be a valid Discord snowflake.`);
    }
    for (let i = 0; i < len; i++) {
        const code = id.charCodeAt(i);
        if (code < 48 || code > 57) {
            throw new TypeError(`${field} must be a valid Discord snowflake.`);
        }
    }
    return id;
}
