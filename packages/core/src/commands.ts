import {
    CreateAttachmentOption,
    CreateBooleanOption,
    CreateChannelOption,
    CreateIntegerOption,
    CreateMentionableOption,
    CreateNumberOption,
    CreateRoleOption,
    CreateSlashCommand,
    CreateStringOption,
    CreateUserOption,
    type CreateCommandOption,
} from "@lunibee/builders";
import type { InteractionReplyOptions } from "@lunibee/structures";
import type {
    CommandInteraction,
    GuildMember,
    Message,
} from "@lunibee/structures";
import {
    ChannelKinds,
    resolveGatewayIntents,
    type APIAttachment,
    type ChannelKind,
} from "@lunibee/types";
import {
    parsePrefixArgs,
    type PrefixArgSpec,
    type PrefixArgType,
    type PrefixArgValue,
} from "@lunibee/utils";
import { PermissionSet, type PermissionName } from "./permissions.js";
import type { Client } from "./index.js";

// ─── Options ─────────────────────────────────────────────────────────────────

/** What every option takes. */
interface OptionConfig {
    /** Shown in Discord's command picker (1-100 characters). Defaults to the option's name. */
    description?: string;
    /** Whether the command cannot run without it. */
    required?: boolean;
}

/** A string option. */
export interface StringConfig extends OptionConfig {
    default?: string;
    /** Shortest and longest accepted text. */
    min?: number;
    max?: number;
    /** Allowed values, as plain text or `{ name, value }` pairs. */
    choices?: readonly (string | { name: string; value: string })[];
}

/** An integer or number option. */
export interface NumberConfig extends OptionConfig {
    default?: number;
    /** Smallest and largest accepted value. */
    min?: number;
    max?: number;
    choices?: readonly (number | { name: string; value: number })[];
}

/** A true/false option. */
export interface BooleanConfig extends OptionConfig {
    default?: boolean;
}

/** A channel option. */
export interface ChannelConfig extends OptionConfig {
    /** Only these kinds of channel are accepted (all by default). */
    kinds?: readonly ChannelKind[];
}

/** A choice between fixed words. */
export interface ChoiceConfig<V extends string> extends OptionConfig {
    default?: V;
}

/** Which option kind a definition is. */
type OptionKind =
    | "string"
    | "integer"
    | "number"
    | "boolean"
    | "user"
    | "channel"
    | "role"
    | "mentionable"
    | "attachment";

/** A mention or id that can be either a user or a role. */
export interface MentionableValue {
    id: string;
    type: "user" | "role";
}

/**
 * One option of a command. `T` is the type the handler receives and `C` the
 * configuration it was made with, which decides whether it can be missing.
 * Make one with {@link option}.
 */
export interface OptionDef<T, C> {
    readonly kind: OptionKind;
    readonly config: C;
    /** Choices for {@link option.choice}; undefined for the other kinds. */
    readonly words?: readonly string[];
    /** Type only: the type the handler receives. Never present at runtime. */
    readonly __type: T;
}

type AnyOption = OptionDef<unknown, object>;

/** The settings every option kind shares, whatever its own configuration adds. */
function settings(def: AnyOption): OptionConfig & { default?: unknown } {
    return def.config as OptionConfig & { default?: unknown };
}
/** The options of a command, by name. */
export type OptionMap = Record<string, AnyOption>;

function define<T, C extends object>(
    kind: OptionKind,
    config: C | undefined,
    words?: readonly string[],
): OptionDef<T, C> {
    return { kind, config: config ?? ({} as C), words } as OptionDef<T, C>;
}

/**
 * Describes the options of a command. The key you give each one in
 * `command({ options })` is its name; the handler gets them typed.
 *
 * - An option is required when `required: true`, and also never missing when it has a `default`.
 * - `user`, `role` and `channel` give the id; `mentionable` gives `{ id, type }`;
 *   `attachment` gives the attachment.
 */
export const option = {
    string: <const C extends StringConfig>(config?: C) =>
        define<string, C>("string", config),
    integer: <const C extends NumberConfig>(config?: C) =>
        define<number, C>("integer", config),
    number: <const C extends NumberConfig>(config?: C) =>
        define<number, C>("number", config),
    boolean: <const C extends BooleanConfig>(config?: C) =>
        define<boolean, C>("boolean", config),
    user: <const C extends OptionConfig>(config?: C) =>
        define<string, C>("user", config),
    role: <const C extends OptionConfig>(config?: C) =>
        define<string, C>("role", config),
    channel: <const C extends ChannelConfig>(config?: C) =>
        define<string, C>("channel", config),
    mentionable: <const C extends OptionConfig>(config?: C) =>
        define<MentionableValue, C>("mentionable", config),
    attachment: <const C extends OptionConfig>(config?: C) =>
        define<APIAttachment, C>("attachment", config),
    /** A choice between fixed words; the handler gets the word, typed as the union. */
    choice: <
        const W extends readonly string[],
        const C extends ChoiceConfig<W[number]>,
    >(
        words: W,
        config?: C,
    ) => define<W[number], C>("string", config, words),
};

type IsNeeded<C> = C extends { required: true }
    ? true
    : C extends { default: string | number | boolean }
      ? true
      : false;

type ValueOf<D> = D extends OptionDef<infer T, unknown> ? T : never;
type ConfigOf<D> = D extends OptionDef<unknown, infer C> ? C : never;
type RequiredKeys<M extends OptionMap> = {
    [K in keyof M]: IsNeeded<ConfigOf<M[K]>> extends true ? K : never;
}[keyof M];

/** The values a handler receives: required (or defaulted) options always, the rest possibly missing. */
export type OptionValues<M extends OptionMap> = {
    [K in RequiredKeys<M>]: ValueOf<M[K]>;
} & {
    [K in Exclude<keyof M, RequiredKeys<M>>]?: ValueOf<M[K]>;
};

// ─── Commands ────────────────────────────────────────────────────────────────

/** What a command handler gets, whether it was run as `/name` or as `!name`. */
export interface CommandContext<M extends OptionMap = OptionMap> {
    bot: Client;
    /** The command's options, typed from its definition. */
    options: OptionValues<M>;
    /** How it was run. */
    source: "slash" | "prefix";
    guildId: string | undefined;
    channelId: string | undefined;
    /** The id of whoever ran it. */
    userId: string;
    /** The person who ran it as a guild member, when it ran in a guild. */
    member: GuildMember | null;
    /** The slash interaction, when `source` is `"slash"`. */
    interaction: CommandInteraction | undefined;
    /** The message, when `source` is `"prefix"`. */
    message: Message | undefined;
    /**
     * Answers the command: an interaction reply for a slash command (a first
     * reply, an edit after `defer()`, then follow-ups), a message reply for a
     * prefix command. `ephemeral` only means something for slash commands.
     */
    reply(content: string | InteractionReplyOptions): Promise<void>;
    /** Tells Discord the answer will take a while (slash commands only; a no-op for prefix commands). */
    defer(options?: { ephemeral?: boolean }): Promise<void>;
}

/** The definition `command()` takes. */
export interface CommandDefinition<M extends OptionMap> {
    /** 1-32 lowercase letters, digits, `-` or `_`. */
    name: string;
    /** 1-100 characters. */
    description: string;
    options?: M;
    /** Permissions the person needs; checked by Discord for slash commands and by Lunibee for prefix commands. Implies `guildOnly`. */
    permissions?: readonly PermissionName[];
    /** Only allow it in servers. */
    guildOnly?: boolean;
    nsfw?: boolean;
    /** Answer `!name args` too, with the same options; `{ aliases }` adds other names. */
    prefix?: boolean | { aliases?: readonly string[] };
    /** Register it as a slash command (default `true`); `false` makes a prefix-only command. */
    slash?: boolean;
    run(context: CommandContext<M>): unknown;
}

/** A command made by {@link command}. */
export interface Command<M extends OptionMap = OptionMap> {
    readonly name: string;
    readonly description: string;
    readonly options: M;
    readonly permissions: readonly PermissionName[];
    readonly guildOnly: boolean;
    readonly nsfw: boolean;
    /** Whether it is registered as a slash command. */
    readonly slash: boolean;
    /** Whether it answers a prefix, and under which other names. */
    readonly prefix: false | { aliases: readonly string[] };
    run(context: CommandContext<M>): unknown;
    /** The slash command as Discord expects it. */
    toJSON(): Record<string, unknown>;
    /** The usage line of the prefix form, such as `!timeout <user> [minutes] [reason…]`. */
    usage(prefix: string): string;
}

const COMMAND_NAME = /^[-_\p{Ll}\p{Lo}\p{N}\p{sc=Deva}\p{sc=Thai}]{1,32}$/u;

const channelTypes = (kinds: readonly ChannelKind[]): number[] => [
    ...new Set(kinds.flatMap((kind) => ChannelKinds[kind])),
];

/** Names an option builder and applies what every option shares. */
function named<B extends CreateCommandOption>(
    builder: B,
    name: string,
    def: AnyOption,
): B {
    const config = settings(def);
    return builder
        .setName(name)
        .setDescription(config.description ?? name)
        .setRequired(config.required === true);
}

/** Adds one option definition to a slash command builder. */
function addOptionTo(
    slash: CreateSlashCommand,
    name: string,
    def: AnyOption,
): void {
    switch (def.kind) {
        case "string": {
            const config = def.config as StringConfig;
            const text = named(new CreateStringOption(), name, def);
            if (config.min !== undefined) text.setMinLength(config.min);
            if (config.max !== undefined) text.setMaxLength(config.max);
            const choices = def.words ?? config.choices;
            if (choices?.length)
                text.addChoices(
                    ...choices.map((choice) =>
                        typeof choice === "string"
                            ? { name: choice, value: choice }
                            : choice,
                    ),
                );
            slash.addStringOption(() => text);
            break;
        }
        case "integer":
        case "number": {
            const config = def.config as NumberConfig;
            const numeric = named(
                def.kind === "integer"
                    ? new CreateIntegerOption()
                    : new CreateNumberOption(),
                name,
                def,
            );
            if (config.min !== undefined) numeric.setMinValue(config.min);
            if (config.max !== undefined) numeric.setMaxValue(config.max);
            if (config.choices?.length)
                numeric.addChoices(
                    ...config.choices.map((choice) =>
                        typeof choice === "number"
                            ? { name: String(choice), value: choice }
                            : choice,
                    ),
                );
            if (def.kind === "integer")
                slash.addIntegerOption(() => numeric as CreateIntegerOption);
            else slash.addNumberOption(() => numeric as CreateNumberOption);
            break;
        }
        case "boolean":
            slash.addBooleanOption(() =>
                named(new CreateBooleanOption(), name, def),
            );
            break;
        case "user":
            slash.addUserOption(() => named(new CreateUserOption(), name, def));
            break;
        case "role":
            slash.addRoleOption(() => named(new CreateRoleOption(), name, def));
            break;
        case "mentionable":
            slash.addMentionableOption(() =>
                named(new CreateMentionableOption(), name, def),
            );
            break;
        case "attachment":
            slash.addAttachmentOption(() =>
                named(new CreateAttachmentOption(), name, def),
            );
            break;
        case "channel": {
            const config = def.config as ChannelConfig;
            const channel = named(new CreateChannelOption(), name, def);
            if (config.kinds?.length)
                channel.addChannelTypes(...channelTypes(config.kinds));
            slash.addChannelOption(() => channel);
            break;
        }
    }
}

const PREFIX_TYPES: Record<OptionKind, PrefixArgType | null> = {
    string: "string",
    integer: "integer",
    number: "number",
    boolean: "boolean",
    user: "user",
    role: "role",
    channel: "channel",
    mentionable: "mentionable",
    attachment: null,
};

/** The argument specs of a command's prefix form; the last text option takes the rest of the message. */
function prefixSpecs(options: OptionMap): PrefixArgSpec[] {
    const entries = Object.entries(options);
    const specs: PrefixArgSpec[] = [];
    for (const [index, [name, def]] of entries.entries()) {
        const type = PREFIX_TYPES[def.kind];
        if (type === null) continue;
        const config = def.config as StringConfig & NumberConfig;
        const choices = (def.words ?? config.choices)?.map((choice) =>
            typeof choice === "object" ? choice.value : choice,
        );
        specs.push({
            name,
            type:
                type === "string" && index === entries.length - 1
                    ? "rest"
                    : type,
            required:
                settings(def).required === true && config.default === undefined,
            min: config.min,
            max: config.max,
            maxLength: def.kind === "string" ? config.max : undefined,
            choices,
        });
    }
    return specs;
}

/**
 * Defines a command once; it can be a slash command, a prefix command, or both.
 * @example
 * export default command({
 *   name: "timeout",
 *   description: "Time a member out",
 *   permissions: ["ModerateMembers"],
 *   options: {
 *     user: option.user({ required: true }),
 *     minutes: option.integer({ min: 1, max: 40_320, default: 10 }),
 *     reason: option.string({ max: 500 }),
 *   },
 *   prefix: true,
 *   async run({ bot, options, guildId, reply }) {
 *     await bot.member(guildId!, options.user).timeout(`${options.minutes}m`, options.reason);
 *     await reply(`Timed out <@${options.user}>.`);
 *   },
 * });
 * @throws {RangeError} For a name, description or option Discord would refuse.
 * @throws {TypeError} If it is neither a slash nor a prefix command, or a required option follows an optional one.
 */
export function command<const M extends OptionMap = Record<never, never>>(
    definition: CommandDefinition<M>,
): Command<M> {
    const slash = definition.slash ?? true;
    const prefix = definition.prefix
        ? {
              aliases:
                  typeof definition.prefix === "object"
                      ? [...(definition.prefix.aliases ?? [])]
                      : [],
          }
        : (false as const);
    if (!COMMAND_NAME.test(definition.name))
        throw new RangeError(
            `Invalid command name: ${definition.name}. Use 1-32 lowercase letters, digits, - or _.`,
        );
    if (
        definition.description.length < 1 ||
        definition.description.length > 100
    )
        throw new RangeError("A command description must be 1-100 characters.");
    if (!slash && !prefix)
        throw new TypeError(
            `Command ${definition.name} is neither a slash nor a prefix command.`,
        );
    for (const alias of prefix ? prefix.aliases : [])
        if (!COMMAND_NAME.test(alias))
            throw new RangeError(
                `Invalid alias for ${definition.name}: ${alias}.`,
            );
    const options = (definition.options ?? {}) as M;
    let optionalSeen: string | undefined;
    for (const [name, def] of Object.entries(options)) {
        const needed = settings(def).required === true;
        if (needed && optionalSeen !== undefined)
            throw new TypeError(
                `Option ${name} is required but follows the optional option ${optionalSeen}; put required options first.`,
            );
        if (!needed) optionalSeen ??= name;
    }
    const permissions = definition.permissions ?? [];
    const guildOnly = definition.guildOnly ?? permissions.length > 0;

    // Fail now, not on first use: this builds every option once.
    const toJSON = (): Record<string, unknown> => {
        const builder = new CreateSlashCommand()
            .setName(definition.name)
            .setDescription(definition.description);
        for (const [name, def] of Object.entries(options))
            addOptionTo(builder, name, def);
        if (permissions.length)
            builder.setDefaultMemberPermissions(
                new PermissionSet([...permissions]).bitfield,
            );
        if (guildOnly) builder.setContexts(0);
        if (definition.nsfw) builder.setNSFW(true);
        return builder.toJSON();
    };
    if (slash) toJSON();

    return Object.freeze({
        name: definition.name,
        description: definition.description,
        options,
        permissions,
        guildOnly,
        nsfw: definition.nsfw ?? false,
        slash,
        prefix,
        run: definition.run,
        toJSON,
        usage(prefixText: string): string {
            const parts = Object.entries(options).map(([name, def]) => {
                const required =
                    settings(def).required === true &&
                    settings(def).default === undefined;
                const label = def.kind === "attachment" ? `${name}📎` : name;
                return required ? `<${label}>` : `[${label}]`;
            });
            return [`${prefixText}${definition.name}`, ...parts].join(" ");
        },
    });
}

// ─── Running commands ────────────────────────────────────────────────────────

function applyDefault(
    def: AnyOption,
    value: PrefixArgValue | APIAttachment | MentionableValue | null | undefined,
): unknown {
    if (value !== null && value !== undefined) return value;
    return settings(def).default;
}

/** Reads a slash command's options as the definition describes them. */
function readSlashOptions(
    options: OptionMap,
    interaction: CommandInteraction,
): Record<string, unknown> {
    const values: Record<string, unknown> = {};
    for (const [name, def] of Object.entries(options)) {
        const source = interaction.options;
        let value: PrefixArgValue | APIAttachment | MentionableValue | null;
        switch (def.kind) {
            case "string":
                value = source.getString(name);
                break;
            case "integer":
                value = source.getInteger(name);
                break;
            case "number":
                value = source.getNumber(name);
                break;
            case "boolean":
                value = source.getBoolean(name);
                break;
            case "user":
                value = idOf(source.getUser(name));
                break;
            case "role":
                value = idOf(source.getRole(name));
                break;
            case "channel":
                value = idOf(source.getChannel(name));
                break;
            case "mentionable": {
                const id = idOf(source.getMentionable(name));
                value = id
                    ? { id, type: source.getMentionableType(name) ?? "user" }
                    : null;
                break;
            }
            case "attachment":
                value = source.getAttachment(name) as APIAttachment | null;
                break;
        }
        values[name] = applyDefault(def, value);
    }
    return values;
}

function idOf(record: Record<string, unknown> | null): string | null {
    return record === null ? null : String(record.id);
}

function words(name: string): string {
    return name.replace(/([a-z])([A-Z])/g, "$1 $2");
}

/** Adds slash and prefix commands and runs them. Reached as `bot.commands`. */
export class CommandRegistry {
    readonly #bot: Client;
    readonly #commands = new Map<string, Command<OptionMap>>();
    readonly #names = new Map<string, Command<OptionMap>>();
    #listening = false;

    public constructor(bot: Client) {
        this.#bot = bot;
    }

    /**
     * Adds commands, replacing one with the same name.
     * @throws {TypeError} If a prefix name or alias is already taken by another command.
     */
    public add(...commands: Command<OptionMap>[]): this {
        for (const added of commands) {
            const taken = [
                added.name,
                ...(added.prefix ? added.prefix.aliases : []),
            ];
            for (const name of taken) {
                const owner = this.#names.get(name);
                if (owner && owner.name !== added.name)
                    throw new TypeError(
                        `The name "${name}" is already used by the ${owner.name} command.`,
                    );
            }
            const previous = this.#commands.get(added.name);
            if (previous)
                for (const name of [
                    previous.name,
                    ...(previous.prefix ? previous.prefix.aliases : []),
                ])
                    this.#names.delete(name);
            this.#commands.set(added.name, added);
            if (added.slash || added.prefix)
                for (const name of taken) this.#names.set(name, added);
        }
        return this;
    }

    /** The command named `name` (or one of its prefix aliases). */
    public get(name: string): Command<OptionMap> | undefined {
        return this.#names.get(name.toLowerCase());
    }

    /** Every command, in the order they were added. */
    public list(): Command<OptionMap>[] {
        return [...this.#commands.values()];
    }

    /**
     * Registers the slash commands with Discord, replacing the ones already
     * registered. Call it once the client is ready.
     * @param options `guildId` registers them in one guild (instant) instead of globally.
     * @returns How many were registered.
     * @throws {Error} If the client is not ready.
     */
    public async deploy(options: { guildId?: string } = {}): Promise<number> {
        if (!this.#bot.isReady())
            throw new Error(
                'Deploy commands after the client is ready: bot.once("ready", () => bot.commands.deploy()).',
            );
        const payloads = this.list()
            .filter((entry) => entry.slash)
            .map((entry) => entry.toJSON()) as unknown as Parameters<
            Client["application"]["commands"]["set"]
        >[0];
        await (options.guildId === undefined
            ? this.#bot.application.commands.set(payloads)
            : this.#bot.application.commands.setGuild(
                  options.guildId,
                  payloads,
              ));
        return payloads.length;
    }

    /**
     * Starts answering: slash commands from interactions and, when `prefix`
     * is given, prefix commands from messages.
     * @param options.prefix The text a message starts with, or several.
     * @throws {TypeError} If called twice.
     */
    public listen(options: { prefix?: string | readonly string[] } = {}): this {
        if (this.#listening)
            throw new TypeError("bot.commands.listen() was already called.");
        this.#listening = true;
        const prefixes =
            options.prefix === undefined
                ? []
                : typeof options.prefix === "string"
                  ? [options.prefix]
                  : [...options.prefix];
        if (prefixes.some((prefix) => prefix === ""))
            throw new TypeError("A command prefix cannot be empty.");

        this.#bot.on("interactionCreate", async (interaction) => {
            if (!interaction.isChatInputCommand()) return;
            const found = this.#commands.get(interaction.commandName);
            if (found?.slash) await this.#runSlash(found, interaction);
        });

        if (prefixes.length) {
            this.#warnAboutIntents();
            this.#bot.on("messageCreate", async (message) => {
                if (message.author.bot) return;
                const prefix = prefixes.find((p) =>
                    message.content.startsWith(p),
                );
                if (prefix !== undefined)
                    await this.#runPrefix(message, prefix);
            });
        }
        return this;
    }

    #warnAboutIntents(): void {
        const intents = resolveGatewayIntents(this.#bot.options.intents);
        const missing: string[] = [];
        if ((intents & (1 << 15)) === 0) missing.push("MessageContent");
        if ((intents & ((1 << 9) | (1 << 12))) === 0)
            missing.push("GuildMessages or DirectMessages");
        if (missing.length === 0) return;
        process.emitWarning(
            `Prefix commands need the ${missing.join(" and ")} intent${missing.length > 1 ? "s" : ""}; without ${missing.length > 1 ? "them" : "it"} Discord sends empty message content and no prefix command will match.`,
            { type: "LunibeeWarning", code: "LUNIBEE_MESSAGE_CONTENT_INTENT" },
        );
    }

    async #runSlash(
        found: Command<OptionMap>,
        interaction: CommandInteraction,
    ): Promise<void> {
        let answered = false;
        const reply = async (
            content: string | InteractionReplyOptions,
        ): Promise<void> => {
            const body = typeof content === "string" ? { content } : content;
            if (answered) await interaction.followUp(body);
            else if (interaction.deferred) await interaction.editReply(body);
            else await interaction.reply(body);
            answered = true;
        };
        await found.run({
            bot: this.#bot,
            options: readSlashOptions(found.options, interaction),
            source: "slash",
            guildId: interaction.guildId,
            channelId: interaction.channelId,
            userId: interaction.user?.id ?? "",
            member: interaction.member,
            interaction,
            message: undefined,
            reply,
            defer: async (deferOptions) => {
                await interaction.deferReply({
                    ephemeral: deferOptions?.ephemeral ?? false,
                });
            },
        } as CommandContext<OptionMap>);
    }

    async #runPrefix(message: Message, prefix: string): Promise<void> {
        const text = message.content.slice(prefix.length).trim();
        const [name = "", ...rest] = text.split(/\s+/);
        const found = this.get(name);
        if (!found?.prefix) return;
        const reply = async (
            content: string | InteractionReplyOptions,
        ): Promise<void> => {
            const { ephemeral: _ephemeral, ...body } =
                typeof content === "string" ? { content } : content;
            await message.reply(body);
        };
        if (found.guildOnly && !message.guildId) {
            await reply("This command only works in servers.");
            return;
        }
        if (found.permissions.length) {
            const lacking = found.permissions.filter(
                (permission) => !message.member?.permissions.has(permission),
            );
            if (lacking.length) {
                await reply(
                    `You need ${lacking.map((p) => `**${words(p)}**`).join(", ")}.`,
                );
                return;
            }
        }
        const parsed = parsePrefixArgs(
            rest.join(" "),
            prefixSpecs(found.options),
        );
        const attachments = [...message.attachments];
        const values: Record<string, unknown> = {};
        if (parsed.ok)
            for (const [key, def] of Object.entries(found.options)) {
                if (def.kind === "attachment") {
                    const attachment = attachments.shift();
                    if (!attachment && settings(def).required === true) {
                        await reply(
                            `\`${key}\` is required. Usage: \`${found.usage(prefix)}\``,
                        );
                        return;
                    }
                    values[key] = applyDefault(def, attachment);
                } else values[key] = applyDefault(def, parsed.values[key]);
            }
        else {
            await reply(
                `\`${parsed.arg}\` ${parsed.error}. Usage: \`${found.usage(prefix)}\``,
            );
            return;
        }
        await found.run({
            bot: this.#bot,
            options: values,
            source: "prefix",
            guildId: message.guildId,
            channelId: message.channelId,
            userId: message.author.id,
            member: message.member ?? null,
            interaction: undefined,
            message,
            reply,
            defer: async () => {},
        } as CommandContext<OptionMap>);
    }
}
