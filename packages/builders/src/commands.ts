/** Discord application command option types. */
export const ApplicationCommandOptionEnum = {
    Subcommand: 1,
    SubcommandGroup: 2,
    String: 3,
    Integer: 4,
    Boolean: 5,
    User: 6,
    Channel: 7,
    Role: 8,
    Mentionable: 9,
    Number: 10,
    Attachment: 11,
} as const;
/** One {@link ApplicationCommandOptionEnum} value, usable as a type. */
export type ApplicationCommandOptionEnum =
    (typeof ApplicationCommandOptionEnum)[keyof typeof ApplicationCommandOptionEnum];

/** Throws unless every context is 0 (guilds), 1 (the bot's DMs) or 2 (other DMs). */
function validateContexts(contexts: number[]): void {
    if (
        contexts.some(
            (context) => context !== 0 && context !== 1 && context !== 2,
        )
    )
        throw new RangeError("Command contexts must be 0, 1 or 2.");
}

/** Builds Discord application command payloads. */
export class CreateSlashCommand {
    readonly #data: Record<string, unknown> = { type: 1 };
    /** Sets the command name. */
    public setName(name: string): this {
        validateName(name, "Command name");
        this.#data.name = name;
        return this;
    }
    /** Sets the command description. */
    public setDescription(description: string): this {
        validateText(description, "Command description", 100);
        this.#data.description = description;
        return this;
    }
    /** Sets where the command can be used: 0 guilds, 1 the bot's DMs, 2 other DMs. @throws {RangeError} For any other value. */
    public setContexts(...contexts: number[]): this {
        validateContexts(contexts);
        this.#data.contexts = [...contexts];
        return this;
    }
    /** Sets whether the command is NSFW. */
    public setNSFW(nsfw = true): this {
        this.#data.nsfw = nsfw;
        return this;
    }
    /** Sets whether the command is NSFW. */
    public setNsfw(nsfw = true): this {
        return this.setNSFW(nsfw);
    }
    /** Sets command default member permissions. */
    public setDefaultMemberPermissions(
        permissions: bigint | number | string | null,
    ): this {
        this.#data.default_member_permissions =
            permissions === null ? null : BigInt(permissions).toString();
        return this;
    }
    /** Sets command integration types. */
    public setIntegrationTypes(...types: number[]): this {
        this.#data.integration_types = [...types];
        return this;
    }
    /** Adds a string option. */
    public addStringOption(
        configure: (option: CreateStringOption) => CreateStringOption,
    ): this {
        return this.addOption(configure(new CreateStringOption()));
    }
    /** Adds an integer option. */
    public addIntegerOption(
        configure: (option: CreateIntegerOption) => CreateIntegerOption,
    ): this {
        return this.addOption(configure(new CreateIntegerOption()));
    }
    /** Adds a number option. */
    public addNumberOption(
        configure: (option: CreateNumberOption) => CreateNumberOption,
    ): this {
        return this.addOption(configure(new CreateNumberOption()));
    }
    /** Adds a boolean option. */
    public addBooleanOption(
        configure: (option: CreateBooleanOption) => CreateBooleanOption,
    ): this {
        return this.addOption(configure(new CreateBooleanOption()));
    }
    /** Adds a user option. */
    public addUserOption(
        configure: (option: CreateUserOption) => CreateUserOption,
    ): this {
        return this.addOption(configure(new CreateUserOption()));
    }
    /** Adds a channel option. */
    public addChannelOption(
        configure: (option: CreateChannelOption) => CreateChannelOption,
    ): this {
        return this.addOption(configure(new CreateChannelOption()));
    }
    /** Adds a role option. */
    public addRoleOption(
        configure: (option: CreateRoleOption) => CreateRoleOption,
    ): this {
        return this.addOption(configure(new CreateRoleOption()));
    }
    /** Adds a mentionable option. */
    public addMentionableOption(
        configure: (option: CreateMentionableOption) => CreateMentionableOption,
    ): this {
        return this.addOption(configure(new CreateMentionableOption()));
    }
    /** Adds an attachment option. */
    public addAttachmentOption(
        configure: (option: CreateAttachmentOption) => CreateAttachmentOption,
    ): this {
        return this.addOption(configure(new CreateAttachmentOption()));
    }
    /** Adds a subcommand. */
    public addSubcommand(
        configure: (option: CreateSubcommand) => CreateSubcommand,
    ): this {
        return this.addOption(configure(new CreateSubcommand()));
    }
    /** Adds a subcommand group. */
    public addSubcommandGroup(
        configure: (option: CreateSubcommandGroup) => CreateSubcommandGroup,
    ): this {
        return this.addOption(configure(new CreateSubcommandGroup()));
    }
    /** Serializes the command payload. */
    public toJSON(): Record<string, unknown> {
        return structuredClone(this.#data);
    }
    /** Adds a validated top-level command option. */
    protected addOption(option: CreateCommandOption): this {
        this.#data.options = appendOption(
            this.#data.options,
            option.toJSON(),
            "application command",
        );
        return this;
    }
}

/** Base builder for command options. */
export class CreateCommandOption {
    protected readonly data: Record<string, unknown>;
    /** Creates an option builder. */
    public constructor(type: number) {
        this.data = { type };
    }
    /** Sets the option name. */
    public setName(name: string): this {
        validateName(name, "Option name");
        this.data.name = name;
        return this;
    }
    /** Sets the option description. */
    public setDescription(description: string): this {
        validateText(description, "Option description", 100);
        this.data.description = description;
        return this;
    }
    /** Makes the option required or optional. */
    public setRequired(required = true): this {
        this.data.required = required;
        return this;
    }
    /** Sets autocomplete. */
    public setAutocomplete(enabled = true): this {
        this.data.autocomplete = enabled;
        return this;
    }
    /** Serializes the option payload. */
    public toJSON(): Record<string, unknown> {
        return structuredClone(this.data);
    }
}

/** Builds a string command option. */
export class CreateStringOption extends CreateCommandOption {
    /** Creates a string option. */
    public constructor() {
        super(ApplicationCommandOptionEnum.String);
    }
    /** Adds string choices. */
    public addChoices(
        ...choices: Array<{ name: string; value: string }>
    ): this {
        for (const choice of choices)
            validateText(choice.value, "Choice value", 100);
        appendChoices(this.data, choices);
        return this;
    }
    /** Sets the minimum string length. */
    public setMinLength(value: number): this {
        validateIntegerRange(value, 0, 6000, "min_length");
        this.data.min_length = value;
        return this;
    }
    /** Sets the maximum string length. */
    public setMaxLength(value: number): this {
        validateIntegerRange(value, 1, 6000, "max_length");
        if (
            (this.data.min_length as number | undefined) !== undefined &&
            (this.data.min_length as number) > value
        )
            throw new RangeError("min_length cannot exceed max_length.");
        this.data.max_length = value;
        return this;
    }
}
/** Shared bounds, choices and autocomplete rules of integer and number options. */
export class CreateNumericOption extends CreateCommandOption {
    readonly #integer: boolean;
    /** Creates a numeric option; `integer` rejects fractional bounds. */
    public constructor(type: number, integer: boolean) {
        super(type);
        this.#integer = integer;
    }
    /** Sets the minimum value. */
    public setMinValue(value: number): this {
        validateNumberRange(
            value,
            -MAX_SAFE,
            MAX_SAFE,
            "min_value",
            this.#integer,
        );
        this.data.min_value = value;
        return this;
    }
    /** Sets the maximum value; it cannot be below the minimum. */
    public setMaxValue(value: number): this {
        validateNumberRange(
            value,
            -MAX_SAFE,
            MAX_SAFE,
            "max_value",
            this.#integer,
        );
        const min = this.data.min_value as number | undefined;
        if (min !== undefined && min > value)
            throw new RangeError("min_value cannot exceed max_value.");
        this.data.max_value = value;
        return this;
    }
    /** Enables autocomplete; options with choices cannot use it. */
    public override setAutocomplete(enabled = true): this {
        if (
            enabled &&
            Array.isArray(this.data.choices) &&
            this.data.choices.length
        )
            throw new RangeError("Autocomplete options cannot define choices.");
        this.data.autocomplete = enabled;
        return this;
    }
    /** Adds fixed choices. */
    public addChoices(...choices: { name: string; value: number }[]): this {
        appendChoices(this.data, choices);
        return this;
    }
}
/** Builds an integer command option. */
export class CreateIntegerOption extends CreateNumericOption {
    public constructor() {
        super(ApplicationCommandOptionEnum.Integer, true);
    }
}
/** Builds a number command option. */
export class CreateNumberOption extends CreateNumericOption {
    public constructor() {
        super(ApplicationCommandOptionEnum.Number, false);
    }
}
/** Builds a boolean command option. */
export class CreateBooleanOption extends CreateCommandOption {
    /** Creates a boolean option. */
    public constructor() {
        super(ApplicationCommandOptionEnum.Boolean);
    }
}
/** Builds a user command option. */
export class CreateUserOption extends CreateCommandOption {
    /** Creates a user option. */
    public constructor() {
        super(ApplicationCommandOptionEnum.User);
    }
}
/** Builds a role command option. */
export class CreateRoleOption extends CreateCommandOption {
    /** Creates a role option. */
    public constructor() {
        super(ApplicationCommandOptionEnum.Role);
    }
}
/** Builds a mentionable command option. */
export class CreateMentionableOption extends CreateCommandOption {
    /** Creates a mentionable option. */
    public constructor() {
        super(ApplicationCommandOptionEnum.Mentionable);
    }
}
/** Builds an attachment command option. */
export class CreateAttachmentOption extends CreateCommandOption {
    /** Creates an attachment option. */
    public constructor() {
        super(ApplicationCommandOptionEnum.Attachment);
    }
}
/** Builds a channel command option. */
export class CreateChannelOption extends CreateCommandOption {
    /** Creates a channel option. */
    public constructor() {
        super(ApplicationCommandOptionEnum.Channel);
    }
    /** Restricts accepted channel types. */
    public addChannelTypes(...types: number[]): this {
        if (types.some((type) => !Number.isInteger(type) || type < 0))
            throw new RangeError(
                "Channel types must be non-negative integers.",
            );
        this.data.channel_types = [...new Set(types)];
        return this;
    }
}
/** Builds a nested subcommand. */
export class CreateSubcommand extends CreateCommandOption {
    /** Creates a subcommand. */
    public constructor() {
        super(ApplicationCommandOptionEnum.Subcommand);
    }
    /** Adds a string option to this subcommand. */
    public addStringOption(
        configure: (option: CreateStringOption) => CreateStringOption,
    ): this {
        return this.addChildOption(configure(new CreateStringOption()));
    }
    /** Adds an integer option to this subcommand. */
    public addIntegerOption(
        configure: (option: CreateIntegerOption) => CreateIntegerOption,
    ): this {
        return this.addChildOption(configure(new CreateIntegerOption()));
    }
    /** Adds a number option to this subcommand. */
    public addNumberOption(
        configure: (option: CreateNumberOption) => CreateNumberOption,
    ): this {
        return this.addChildOption(configure(new CreateNumberOption()));
    }
    /** Adds a boolean option to this subcommand. */
    public addBooleanOption(
        configure: (option: CreateBooleanOption) => CreateBooleanOption,
    ): this {
        return this.addChildOption(configure(new CreateBooleanOption()));
    }
    /** Adds a user option to this subcommand. */
    public addUserOption(
        configure: (option: CreateUserOption) => CreateUserOption,
    ): this {
        return this.addChildOption(configure(new CreateUserOption()));
    }
    /** Adds a channel option to this subcommand. */
    public addChannelOption(
        configure: (option: CreateChannelOption) => CreateChannelOption,
    ): this {
        return this.addChildOption(configure(new CreateChannelOption()));
    }
    /** Adds a role option to this subcommand. */
    public addRoleOption(
        configure: (option: CreateRoleOption) => CreateRoleOption,
    ): this {
        return this.addChildOption(configure(new CreateRoleOption()));
    }
    /** Adds a mentionable option to this subcommand. */
    public addMentionableOption(
        configure: (option: CreateMentionableOption) => CreateMentionableOption,
    ): this {
        return this.addChildOption(configure(new CreateMentionableOption()));
    }
    /** Adds an attachment option to this subcommand. */
    public addAttachmentOption(
        configure: (option: CreateAttachmentOption) => CreateAttachmentOption,
    ): this {
        return this.addChildOption(configure(new CreateAttachmentOption()));
    }
    protected addChildOption(option: CreateCommandOption): this {
        const options =
            (this.data.options as OptionPayload[] | undefined) ?? [];
        if (
            options.some(
                (existing) =>
                    existing.type === ApplicationCommandOptionEnum.Subcommand,
            )
        )
            throw new RangeError(
                "Subcommands cannot contain nested subcommands.",
            );
        this.data.options = appendOption(
            options,
            option.toJSON(),
            "subcommand",
        );
        return this;
    }
}
/** Builds a nested subcommand group. */
export class CreateSubcommandGroup extends CreateCommandOption {
    /** Creates a subcommand group. */
    public constructor() {
        super(ApplicationCommandOptionEnum.SubcommandGroup);
    }
    /** Adds a subcommand to this group. */
    public addSubcommand(
        configure: (option: CreateSubcommand) => CreateSubcommand,
    ): this {
        const options = (this.data.options as unknown[] | undefined) ?? [];
        if (options.length >= 25)
            throw new RangeError(
                "A subcommand group cannot contain more than 25 subcommands.",
            );
        const payload = configure(new CreateSubcommand()).toJSON();
        if (
            options.some(
                (existing) =>
                    (existing as Record<string, unknown>).name === payload.name,
            )
        )
            throw new RangeError(
                `Duplicate subcommand name: ${String(payload.name)}.`,
            );
        if (payload.type !== ApplicationCommandOptionEnum.Subcommand)
            throw new TypeError(
                "Subcommand group children must be subcommands.",
            );
        options.push(payload);
        this.data.options = options;
        return this;
    }
}
const MAX_SAFE = Number.MAX_SAFE_INTEGER;

/** A serialized option as stored on its parent. */
type OptionPayload = Record<string, unknown>;

/**
 * Returns `options` with `payload` appended, enforcing Discord's limit of 25,
 * unique names, and required options before optional ones.
 */
function appendOption(
    options: unknown,
    payload: OptionPayload,
    parent: "application command" | "subcommand",
): OptionPayload[] {
    const list = (options as OptionPayload[] | undefined) ?? [];
    if (list.length >= 25)
        throw new RangeError(
            `${parent === "subcommand" ? "A subcommand" : "An application command"} cannot contain more than 25 options.`,
        );
    if (list.some((existing) => existing.name === payload.name))
        throw new RangeError(`Duplicate option name: ${String(payload.name)}.`);
    if (
        payload.required === true &&
        list.some((existing) => existing.required !== true)
    )
        throw new RangeError(
            `Required ${parent} options must be placed before optional options.`,
        );
    return [...list, payload];
}

/** Appends choices to an option, enforcing the shared choice rules. */
function appendChoices(
    data: OptionPayload,
    choices: { name: string; value: string | number }[],
): void {
    const current = (data.choices as unknown[] | undefined) ?? [];
    if (!choices.length)
        throw new TypeError("At least one choice is required.");
    if (data.autocomplete === true)
        throw new RangeError("Autocomplete options cannot define choices.");
    if (current.length + choices.length > 25)
        throw new RangeError("An option cannot contain more than 25 choices.");
    for (const choice of choices) validateText(choice.name, "Choice name", 100);
    data.choices = [...current, ...choices.map((choice) => ({ ...choice }))];
}

function validateName(value: string, field: string): void {
    if (!/^[\p{L}\p{N}_-]{1,32}$/u.test(value) || value !== value.toLowerCase())
        throw new RangeError(
            `${field} must contain 1-32 lowercase letters, numbers, underscores, or hyphens.`,
        );
}
function validateText(value: string, field: string, max: number): void {
    if (typeof value !== "string" || !value.trim() || value.length > max)
        throw new RangeError(`${field} must contain 1-${max} characters.`);
}
function validateIntegerRange(
    value: number,
    minimum: number,
    maximum: number,
    field: string,
): void {
    if (!Number.isInteger(value) || value < minimum || value > maximum)
        throw new RangeError(
            `${field} must be an integer between ${minimum} and ${maximum}.`,
        );
}
function validateNumberRange(
    value: number,
    minimum: number,
    maximum: number,
    field: string,
    integerOnly = true,
): void {
    if (
        !Number.isFinite(value) ||
        (integerOnly && !Number.isInteger(value)) ||
        value < minimum ||
        value > maximum
    )
        throw new RangeError(
            `${field} must be ${integerOnly ? "an integer" : "a number"} between ${minimum} and ${maximum}.`,
        );
}

// ─── Context Menu Builders ────────────────────────────────────────────────────

/** Builder for application commands that appear in right-click context menus.
 * Discord.js-familiar: `new CreateContextMenuCommand().setName("x").setType(2)`. */
export class CreateContextMenuCommand {
    protected readonly data: Record<string, unknown>;
    public constructor(type: 2 | 3 = 2) {
        this.data = { type };
    }
    /** Sets the command type: 2 = USER, 3 = MESSAGE. @throws {RangeError} For any other type. */
    public setType(type: 2 | 3): this {
        if (type !== 2 && type !== 3)
            throw new RangeError("Context menu command type must be 2 or 3.");
        this.data.type = type;
        return this;
    }
    /** Sets the command name (shown in the right-click menu).
     * Unlike CHAT_INPUT commands, USER (type 2) and MESSAGE (type 3) context-menu
     * command names may contain uppercase letters and spaces, so no lowercase/charset
     * validation is applied here — only Discord's 1-32 length limit and a non-empty
     * (non-whitespace) requirement are enforced.
     * @param name Display name; 1-32 characters, mixed case and spaces allowed.
     * @throws {RangeError} If the name is empty/whitespace-only or exceeds 32 characters.
     */
    public setName(name: string): this {
        if (
            typeof name !== "string" ||
            name.trim().length < 1 ||
            name.length > 32
        )
            throw new RangeError("Command name must contain 1-32 characters.");
        this.data.name = name;
        return this;
    }
    /** Sets default member permissions required to see this command. */
    public setDefaultMemberPermissions(
        permissions: bigint | number | string | null,
    ): this {
        this.data.default_member_permissions =
            permissions === null ? null : BigInt(permissions).toString();
        return this;
    }
    /** Sets command integration types (0 guild install, 1 user install). */
    public setIntegrationTypes(...types: number[]): this {
        this.data.integration_types = [...types];
        return this;
    }
    /** Sets where the command can be used: 0 guilds, 1 the bot's DMs, 2 other DMs. @throws {RangeError} For any other value. */
    public setContexts(...contexts: number[]): this {
        validateContexts(contexts);
        this.data.contexts = [...contexts];
        return this;
    }
    /** Sets the name shown per locale, e.g. `{ "es-ES": "Ver perfil" }`; null clears it. */
    public setNameLocalizations(
        localizations: Record<string, string> | null,
    ): this {
        this.data.name_localizations =
            localizations === null ? null : { ...localizations };
        return this;
    }
    /** Serializes the command payload for the Discord API. */
    public toJSON(): Record<string, unknown> {
        return structuredClone(this.data);
    }
}

/** Builds a User context menu command (appears when right-clicking a user, type 2).
 * @example
 * new CreateUserCommand().setName("View Profile").toJSON()
 */
export class CreateUserCommand extends CreateContextMenuCommand {
    public constructor() {
        super(2);
    }
}

/** Builds a Message context menu command (appears when right-clicking a message, type 3).
 * @example
 * new CreateMessageCommand().setName("Translate Message").toJSON()
 */
export class CreateMessageCommand extends CreateContextMenuCommand {
    public constructor() {
        super(3);
    }
}
