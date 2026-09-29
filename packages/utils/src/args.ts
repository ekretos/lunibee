/**
 * Prefix-command arguments: split a message into arguments and read them as
 * typed values, the way slash-command options are read.
 */

/** What an argument is read as. `rest` takes everything left, as one string. */
export type PrefixArgType =
    | "string"
    | "integer"
    | "number"
    | "boolean"
    | "user"
    | "role"
    | "channel"
    | "mentionable"
    | "rest";

/** One expected argument. */
export interface PrefixArgSpec {
    name: string;
    type: PrefixArgType;
    required?: boolean;
    /** For `string` and `rest`: the longest accepted value. */
    maxLength?: number;
    /** For `integer` and `number`: the accepted range. */
    min?: number;
    max?: number;
    /** Accepted values (compared case-insensitively for strings). */
    choices?: readonly (string | number)[];
}

/** A mentionable argument: which kind of mention it was. An unmarked ID reads as a user. */
export interface MentionableArg {
    id: string;
    type: "user" | "role";
}

export type PrefixArgValue = string | number | boolean | MentionableArg;

export type PrefixArgsResult =
    | { ok: true; values: Record<string, PrefixArgValue | undefined> }
    | { ok: false; arg: string; error: string };

const SNOWFLAKE = /^\d{16,22}$/;
const TRUE_WORDS = new Set([
    "true",
    "yes",
    "y",
    "on",
    "1",
    "enable",
    "enabled",
]);
const FALSE_WORDS = new Set([
    "false",
    "no",
    "n",
    "off",
    "0",
    "disable",
    "disabled",
]);

/**
 * Splits text into arguments on whitespace. "Double quotes" or 'single quotes'
 * keep spaces inside one argument; a backslash escapes the next character.
 * @example tokenizeArgs(`ban @user "being rude"`) // ["ban", "@user", "being rude"]
 */
export function tokenizeArgs(input: string): string[] {
    const args: string[] = [];
    let current = "";
    let quote: string | null = null;
    let started = false;
    for (let index = 0; index < input.length; index++) {
        const character = input[index]!;
        if (character === "\\" && index + 1 < input.length) {
            current += input[++index];
            started = true;
        } else if (quote) {
            if (character === quote) quote = null;
            else current += character;
        } else if (character === '"' || character === "'") {
            // A quote opens a quoted part only at the start of an argument.
            if (started) current += character;
            else {
                quote = character;
                started = true;
            }
        } else if (/\s/.test(character)) {
            if (started) args.push(current);
            current = "";
            started = false;
        } else {
            current += character;
            started = true;
        }
    }
    if (started) args.push(current);
    return args;
}

/** The user ID in `<@id>`, `<@!id>` or a bare ID; null otherwise. */
export function parseUserMention(value: string): string | null {
    const id = /^<@!?(\d{16,22})>$/.exec(value)?.[1] ?? value;
    return SNOWFLAKE.test(id) ? id : null;
}

/** The role ID in `<@&id>` or a bare ID; null otherwise. */
export function parseRoleMention(value: string): string | null {
    const id = /^<@&(\d{16,22})>$/.exec(value)?.[1] ?? value;
    return SNOWFLAKE.test(id) ? id : null;
}

/** The channel ID in `<#id>` or a bare ID; null otherwise. */
export function parseChannelMention(value: string): string | null {
    const id = /^<#(\d{16,22})>$/.exec(value)?.[1] ?? value;
    return SNOWFLAKE.test(id) ? id : null;
}

/** A user or role mention; a bare ID reads as a user. Null otherwise. */
export function parseMentionable(value: string): MentionableArg | null {
    const role = /^<@&(\d{16,22})>$/.exec(value)?.[1];
    if (role) return { id: role, type: "role" };
    const user = parseUserMention(value);
    return user ? { id: user, type: "user" } : null;
}

function readOne(
    spec: PrefixArgSpec,
    raw: string,
): { value: PrefixArgValue } | { error: string } {
    switch (spec.type) {
        case "string":
        case "rest":
            if (spec.maxLength !== undefined && raw.length > spec.maxLength)
                return {
                    error: `must be at most ${spec.maxLength} characters`,
                };
            if (
                spec.choices &&
                !spec.choices.some(
                    (choice) =>
                        String(choice).toLowerCase() === raw.toLowerCase(),
                )
            )
                return { error: `must be one of: ${spec.choices.join(", ")}` };
            return { value: raw };
        case "integer":
        case "number": {
            const value = Number(raw);
            if (!Number.isFinite(value) || raw.trim() === "")
                return { error: "must be a number" };
            if (spec.type === "integer" && !Number.isSafeInteger(value))
                return { error: "must be a whole number" };
            if (spec.min !== undefined && value < spec.min)
                return { error: `must be at least ${spec.min}` };
            if (spec.max !== undefined && value > spec.max)
                return { error: `must be at most ${spec.max}` };
            if (spec.choices && !spec.choices.includes(value))
                return { error: `must be one of: ${spec.choices.join(", ")}` };
            return { value };
        }
        case "boolean": {
            const word = raw.toLowerCase();
            if (TRUE_WORDS.has(word)) return { value: true };
            if (FALSE_WORDS.has(word)) return { value: false };
            return { error: "must be yes or no" };
        }
        case "user": {
            const id = parseUserMention(raw);
            return id
                ? { value: id }
                : { error: "must be a user mention or ID" };
        }
        case "role": {
            const id = parseRoleMention(raw);
            return id
                ? { value: id }
                : { error: "must be a role mention or ID" };
        }
        case "channel": {
            const id = parseChannelMention(raw);
            return id
                ? { value: id }
                : { error: "must be a channel mention or ID" };
        }
        case "mentionable": {
            const value = parseMentionable(raw);
            return value
                ? { value }
                : { error: "must be a user or role mention" };
        }
    }
}

/**
 * Reads prefix-command arguments by position, as typed values. IDs come back
 * as strings (user, role, channel); a mentionable says which it was. The first
 * problem is reported, with the argument's name, instead of throwing.
 * @param input The text after the command name, or already-split arguments.
 * @param specs The expected arguments in order; a `rest` argument must be last.
 * @example
 * const result = parsePrefixArgs(`@user 10 spamming links`, [
 *     { name: "user", type: "user", required: true },
 *     { name: "minutes", type: "integer", min: 1, max: 40320 },
 *     { name: "reason", type: "rest" },
 * ]);
 * if (!result.ok) return message.reply(`\`${result.arg}\` ${result.error}.`);
 */
export function parsePrefixArgs(
    input: string | readonly string[],
    specs: readonly PrefixArgSpec[],
): PrefixArgsResult {
    const args = typeof input === "string" ? tokenizeArgs(input) : [...input];
    const values: Record<string, PrefixArgValue | undefined> = {};
    let position = 0;
    for (const [index, spec] of specs.entries()) {
        if (spec.type === "rest" && index !== specs.length - 1)
            throw new TypeError(
                `The rest argument "${spec.name}" must be the last one.`,
            );
        const raw =
            spec.type === "rest"
                ? args.slice(position).join(" ")
                : args[position];
        if (raw === undefined || raw === "") {
            if (spec.required)
                return { ok: false, arg: spec.name, error: "is required" };
            values[spec.name] = undefined;
            continue;
        }
        const read = readOne(spec, raw);
        if ("error" in read)
            return { ok: false, arg: spec.name, error: read.error };
        values[spec.name] = read.value;
        position += spec.type === "rest" ? args.length : 1;
    }
    return { ok: true, values };
}

/** Discord application-command option types, as numbers (this package has no dependencies). */
const OPTION_TYPES: Readonly<Record<number, PrefixArgType>> = {
    3: "string",
    4: "integer",
    5: "boolean",
    6: "user",
    7: "channel",
    8: "role",
    9: "mentionable",
    10: "number",
};

/**
 * Argument specs from a slash command's options, so one definition serves both
 * `/command` and the prefix command. Subcommands and attachments are left out.
 * @param options The command's (or subcommand's) `options` as sent to Discord.
 * @param restLast Read the last string option as the rest of the message (handy for reasons).
 */
export function argsFromCommandOptions(
    options: readonly {
        name: string;
        type: number;
        required?: boolean;
        min_value?: number;
        max_value?: number;
        max_length?: number;
        choices?: readonly { value: string | number }[];
    }[],
    restLast = false,
): PrefixArgSpec[] {
    const specs: PrefixArgSpec[] = [];
    for (const option of options) {
        const type = OPTION_TYPES[option.type];
        if (!type) continue;
        specs.push({
            name: option.name,
            type,
            required: option.required,
            min: option.min_value,
            max: option.max_value,
            maxLength: option.max_length,
            choices: option.choices?.map((choice) => choice.value),
        });
    }
    const last = specs[specs.length - 1];
    if (restLast && last?.type === "string") last.type = "rest";
    return specs;
}
