/** Returns a promise that resolves after the specified duration. */
export function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Returns an integer between the supplied inclusive bounds. */
export function randomInt(min: number, max: number): number {
    return Math.floor(Math.random() * (max - min + 1)) + min;
}

/**
 * Tests whether a value looks like a Discord snowflake: 16 to 20 digits. A
 * snowflake is an unsigned 64-bit number, so it never has more than 20 digits;
 * the minimum keeps short numbers in text from being read as IDs. (`Routes`
 * only validates IDs it is given, so it accepts 1 to 20 digits.)
 */
export function isSnowflake(value: string): boolean {
    return /^\d{16,20}$/.test(value);
}

export {
    tokenizeArgs,
    parsePrefixArgs,
    argsFromCommandOptions,
    parseUserMention,
    parseRoleMention,
    parseChannelMention,
    parseMentionable,
    type PrefixArgType,
    type PrefixArgSpec,
    type PrefixArgValue,
    type PrefixArgsResult,
    type MentionableArg,
} from "./args.js";
