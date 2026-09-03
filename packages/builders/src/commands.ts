/** Discord application command option types. */
export const ApplicationCommandOptionType = {
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

/** Builds Discord application command payloads. */
export class SlashCommandBuilder {
    readonly #data: Record<string, unknown> = { type: 1 };
    /** Sets the command name. */ public setName(name: string): this {
        validateName(name, "Command name");
        this.#data.name = name;
        return this;
    }
    /** Sets the command description. */ public setDescription(
        description: string,
    ): this {
        validateText(description, "Command description", 100);
        this.#data.description = description;
        return this;
    }
    /** Sets whether the command is available in direct messages. */ public setDMPermission(
        enabled: boolean,
    ): this {
        this.#data.dm_permission = enabled;
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
    /** Sets command default member permissions. */ public setDefaultMemberPermissions(
        permissions: bigint | number | string | null,
    ): this {
        this.#data.default_member_permissions =
            permissions === null ? null : BigInt(permissions).toString();
        return this;
    }
    /** Sets command integration types. */ public setIntegrationTypes(
        ...types: number[]
    ): this {
        this.#data.integration_types = [...types];
        return this;
    }
    /** Adds a string option. */ public addStringOption(
        configure: (option: StringOptionBuilder) => StringOptionBuilder,
    ): this {
        return this.addOption(configure(new StringOptionBuilder()));
    }
    /** Adds an integer option. */ public addIntegerOption(
        configure: (option: IntegerOptionBuilder) => IntegerOptionBuilder,
    ): this {
        return this.addOption(configure(new IntegerOptionBuilder()));
    }
    /** Adds a number option. */ public addNumberOption(
        configure: (option: NumberOptionBuilder) => NumberOptionBuilder,
    ): this {
        return this.addOption(configure(new NumberOptionBuilder()));
    }
    /** Adds a boolean option. */ public addBooleanOption(
        configure: (option: BooleanOptionBuilder) => BooleanOptionBuilder,
    ): this {
        return this.addOption(configure(new BooleanOptionBuilder()));
    }
    /** Adds a user option. */ public addUserOption(
        configure: (option: UserOptionBuilder) => UserOptionBuilder,
    ): this {
        return this.addOption(configure(new UserOptionBuilder()));
    }
    /** Adds a channel option. */ public addChannelOption(
        configure: (option: ChannelOptionBuilder) => ChannelOptionBuilder,
    ): this {
        return this.addOption(configure(new ChannelOptionBuilder()));
    }
    /** Adds a role option. */ public addRoleOption(
        configure: (option: RoleOptionBuilder) => RoleOptionBuilder,
    ): this {
        return this.addOption(configure(new RoleOptionBuilder()));
    }
    /** Adds a mentionable option. */ public addMentionableOption(
        configure: (
            option: MentionableOptionBuilder,
        ) => MentionableOptionBuilder,
    ): this {
        return this.addOption(configure(new MentionableOptionBuilder()));
    }
    /** Adds an attachment option. */ public addAttachmentOption(
        configure: (option: AttachmentOptionBuilder) => AttachmentOptionBuilder,
    ): this {
        return this.addOption(configure(new AttachmentOptionBuilder()));
    }
    /** Adds a subcommand. */ public addSubcommand(
        configure: (option: SubcommandBuilder) => SubcommandBuilder,
    ): this {
        return this.addOption(configure(new SubcommandBuilder()));
    }
    /** Adds a subcommand group. */ public addSubcommandGroup(
        configure: (option: SubcommandGroupBuilder) => SubcommandGroupBuilder,
    ): this {
        return this.addOption(configure(new SubcommandGroupBuilder()));
    }
    /** Serializes the command payload. */ public toJSON(): Record<
        string,
        unknown
    > {
        return structuredClone(this.#data);
    }
    /** Adds a validated top-level command option. */ protected addOption(
        option: CommandOptionBuilder,
    ): this {
        const options = (this.#data.options as unknown[] | undefined) ?? [];
        if (options.length >= 25)
            throw new RangeError(
                "An application command cannot contain more than 25 options.",
            );
        const payload = option.toJSON();
        if (
            options.some(
                (existing) =>
                    (existing as Record<string, unknown>).name === payload.name,
            )
        )
            throw new RangeError(
                `Duplicate option name: ${String(payload.name)}.`,
            );
        if (
            payload.required === true &&
            options.some(
                (existing) =>
                    (existing as Record<string, unknown>).required !== true,
            )
        )
            throw new RangeError(
                "Required application command options must be placed before optional options.",
            );
        options.push(payload);
        this.#data.options = options;
        return this;
    }
}

/** Base builder for command options. */
export class CommandOptionBuilder {
    protected readonly data: Record<string, unknown>;
    /** Creates an option builder. */ public constructor(type: number) {
        this.data = { type };
    }
    /** Sets the option name. */ public setName(name: string): this {
        validateName(name, "Option name");
        this.data.name = name;
        return this;
    }
    /** Sets the option description. */ public setDescription(
        description: string,
    ): this {
        validateText(description, "Option description", 100);
        this.data.description = description;
        return this;
    }
    /** Makes the option required or optional. */ public setRequired(
        required = true,
    ): this {
        this.data.required = required;
        return this;
    }
    /** Sets autocomplete. */ public setAutocomplete(enabled = true): this {
        this.data.autocomplete = enabled;
        return this;
    }
    /** Serializes the option payload. */ public toJSON(): Record<
        string,
        unknown
    > {
        return structuredClone(this.data);
    }
}

/** Builds a string command option. */
export class StringOptionBuilder extends CommandOptionBuilder {
    /** Creates a string option. */ public constructor() {
        super(ApplicationCommandOptionType.String);
    }
    /** Adds string choices. */ public addChoices(
        ...choices: Array<{ name: string; value: string }>
    ): this {
        const current = (this.data.choices as unknown[] | undefined) ?? [];
        if (!choices.length)
            throw new TypeError("At least one choice is required.");
        if (this.data.autocomplete === true)
            throw new RangeError("Autocomplete options cannot define choices.");
        if (current.length + choices.length > 25)
            throw new RangeError(
                "An option cannot contain more than 25 choices.",
            );
        for (const choice of choices) {
            validateText(choice.name, "Choice name", 100);
            validateText(choice.value, "Choice value", 100);
        }
        this.data.choices = [
            ...current,
            ...choices.map((choice) => ({ ...choice })),
        ];
        return this;
    }
    /** Sets the minimum string length. */ public setMinLength(
        value: number,
    ): this {
        validateIntegerRange(value, 0, 6000, "min_length");
        this.data.min_length = value;
        return this;
    }
    /** Sets the maximum string length. */ public setMaxLength(
        value: number,
    ): this {
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
/** Builds an integer command option. */
export class IntegerOptionBuilder extends CommandOptionBuilder {
    public constructor() {
        super(ApplicationCommandOptionType.Integer);
    }
    public setMinValue(value: number): this {
        validateNumberRange(
            value,
            -9_007_199_254_740_991,
            9_007_199_254_740_991,
            "min_value",
            true,
        );
        this.data.min_value = value;
        return this;
    }
    public setMaxValue(value: number): this {
        validateNumberRange(
            value,
            -9_007_199_254_740_991,
            9_007_199_254_740_991,
            "max_value",
            true,
        );
        if (
            (this.data.min_value as number | undefined) !== undefined &&
            (this.data.min_value as number) > value
        )
            throw new RangeError("min_value cannot exceed max_value.");
        this.data.max_value = value;
        return this;
    }
    public setAutocomplete(enabled = true): this {
        if (
            enabled &&
            Array.isArray(this.data.choices) &&
            this.data.choices.length
        )
            throw new RangeError("Autocomplete options cannot define choices.");
        this.data.autocomplete = enabled;
        return this;
    }
    public addChoices(...choices: { name: string; value: number }[]): this {
        const current = (this.data.choices as unknown[] | undefined) ?? [];
        if (!choices.length)
            throw new TypeError("At least one choice is required.");
        if (this.data.autocomplete === true)
            throw new RangeError("Autocomplete options cannot define choices.");
        if (current.length + choices.length > 25)
            throw new RangeError(
                "An option cannot contain more than 25 choices.",
            );
        this.data.choices = [...current, ...choices];
        return this;
    }
}
/** Builds a number command option. */
export class NumberOptionBuilder extends CommandOptionBuilder {
    public constructor() {
        super(ApplicationCommandOptionType.Number);
    }
    public setMinValue(value: number): this {
        validateNumberRange(
            value,
            -9_007_199_254_740_991,
            9_007_199_254_740_991,
            "min_value",
            false,
        );
        this.data.min_value = value;
        return this;
    }
    public setMaxValue(value: number): this {
        validateNumberRange(
            value,
            -9_007_199_254_740_991,
            9_007_199_254_740_991,
            "max_value",
            false,
        );
        if (
            (this.data.min_value as number | undefined) !== undefined &&
            (this.data.min_value as number) > value
        )
            throw new RangeError("min_value cannot exceed max_value.");
        this.data.max_value = value;
        return this;
    }
    public setAutocomplete(enabled = true): this {
        if (
            enabled &&
            Array.isArray(this.data.choices) &&
            this.data.choices.length
        )
            throw new RangeError("Autocomplete options cannot define choices.");
        this.data.autocomplete = enabled;
        return this;
    }
    public addChoices(...choices: { name: string; value: number }[]): this {
        const current = (this.data.choices as unknown[] | undefined) ?? [];
        if (!choices.length)
            throw new TypeError("At least one choice is required.");
        if (this.data.autocomplete === true)
            throw new RangeError("Autocomplete options cannot define choices.");
        if (current.length + choices.length > 25)
            throw new RangeError(
                "An option cannot contain more than 25 choices.",
            );
        this.data.choices = [...current, ...choices];
        return this;
    }
}
/** Builds a boolean command option. */ export class BooleanOptionBuilder extends CommandOptionBuilder {
    /** Creates a boolean option. */ public constructor() {
        super(ApplicationCommandOptionType.Boolean);
    }
}
/** Builds a user command option. */ export class UserOptionBuilder extends CommandOptionBuilder {
    /** Creates a user option. */ public constructor() {
        super(ApplicationCommandOptionType.User);
    }
}
/** Builds a role command option. */ export class RoleOptionBuilder extends CommandOptionBuilder {
    /** Creates a role option. */ public constructor() {
        super(ApplicationCommandOptionType.Role);
    }
}
/** Builds a mentionable command option. */ export class MentionableOptionBuilder extends CommandOptionBuilder {
    /** Creates a mentionable option. */ public constructor() {
        super(ApplicationCommandOptionType.Mentionable);
    }
}
/** Builds an attachment command option. */ export class AttachmentOptionBuilder extends CommandOptionBuilder {
    /** Creates an attachment option. */ public constructor() {
        super(ApplicationCommandOptionType.Attachment);
    }
}
/** Builds a channel command option. */ export class ChannelOptionBuilder extends CommandOptionBuilder {
    /** Creates a channel option. */ public constructor() {
        super(ApplicationCommandOptionType.Channel);
    }
    /** Restricts accepted channel types. */ public addChannelTypes(
        ...types: number[]
    ): this {
        if (types.some((type) => !Number.isInteger(type) || type < 0))
            throw new RangeError(
                "Channel types must be non-negative integers.",
            );
        this.data.channel_types = [...new Set(types)];
        return this;
    }
}
/** Builds a nested subcommand. */ export class SubcommandBuilder extends CommandOptionBuilder {
    /** Creates a subcommand. */ public constructor() {
        super(ApplicationCommandOptionType.Subcommand);
    }
    /** Adds a string option to this subcommand. */ public addStringOption(
        configure: (option: StringOptionBuilder) => StringOptionBuilder,
    ): this {
        return this.addChildOption(configure(new StringOptionBuilder()));
    }
    /** Adds an integer option to this subcommand. */ public addIntegerOption(
        configure: (option: IntegerOptionBuilder) => IntegerOptionBuilder,
    ): this {
        return this.addChildOption(configure(new IntegerOptionBuilder()));
    }
    /** Adds a number option to this subcommand. */ public addNumberOption(
        configure: (option: NumberOptionBuilder) => NumberOptionBuilder,
    ): this {
        return this.addChildOption(configure(new NumberOptionBuilder()));
    }
    /** Adds a boolean option to this subcommand. */ public addBooleanOption(
        configure: (option: BooleanOptionBuilder) => BooleanOptionBuilder,
    ): this {
        return this.addChildOption(configure(new BooleanOptionBuilder()));
    }
    /** Adds a user option to this subcommand. */ public addUserOption(
        configure: (option: UserOptionBuilder) => UserOptionBuilder,
    ): this {
        return this.addChildOption(configure(new UserOptionBuilder()));
    }
    /** Adds a channel option to this subcommand. */ public addChannelOption(
        configure: (option: ChannelOptionBuilder) => ChannelOptionBuilder,
    ): this {
        return this.addChildOption(configure(new ChannelOptionBuilder()));
    }
    /** Adds a role option to this subcommand. */ public addRoleOption(
        configure: (option: RoleOptionBuilder) => RoleOptionBuilder,
    ): this {
        return this.addChildOption(configure(new RoleOptionBuilder()));
    }
    /** Adds a mentionable option to this subcommand. */ public addMentionableOption(
        configure: (
            option: MentionableOptionBuilder,
        ) => MentionableOptionBuilder,
    ): this {
        return this.addChildOption(configure(new MentionableOptionBuilder()));
    }
    /** Adds an attachment option to this subcommand. */ public addAttachmentOption(
        configure: (option: AttachmentOptionBuilder) => AttachmentOptionBuilder,
    ): this {
        return this.addChildOption(configure(new AttachmentOptionBuilder()));
    }
    protected addChildOption(option: CommandOptionBuilder): this {
        const options = (this.data.options as unknown[] | undefined) ?? [];
        if (options.length >= 25)
            throw new RangeError(
                "A subcommand cannot contain more than 25 options.",
            );
        const payload = option.toJSON();
        if (
            options.some(
                (existing) =>
                    (existing as Record<string, unknown>).name === payload.name,
            )
        )
            throw new RangeError(
                `Duplicate option name: ${String(payload.name)}.`,
            );
        if (
            payload.required === true &&
            options.some(
                (existing) =>
                    (existing as Record<string, unknown>).required !== true,
            )
        )
            throw new RangeError(
                "Required subcommand options must be placed before optional options.",
            );
        if (
            options.some(
                (existing) =>
                    (existing as Record<string, unknown>).type ===
                    ApplicationCommandOptionType.Subcommand,
            )
        )
            throw new RangeError(
                "Subcommands cannot contain nested subcommands.",
            );
        options.push(payload);
        this.data.options = options;
        return this;
    }
}
/** Builds a nested subcommand group. */ export class SubcommandGroupBuilder extends CommandOptionBuilder {
    /** Creates a subcommand group. */ public constructor() {
        super(ApplicationCommandOptionType.SubcommandGroup);
    }
    /** Adds a subcommand to this group. */ public addSubcommand(
        configure: (option: SubcommandBuilder) => SubcommandBuilder,
    ): this {
        const options = (this.data.options as unknown[] | undefined) ?? [];
        if (options.length >= 25)
            throw new RangeError(
                "A subcommand group cannot contain more than 25 subcommands.",
            );
        const payload = configure(new SubcommandBuilder()).toJSON();
        if (
            options.some(
                (existing) =>
                    (existing as Record<string, unknown>).name === payload.name,
            )
        )
            throw new RangeError(
                `Duplicate subcommand name: ${String(payload.name)}.`,
            );
        if (payload.type !== ApplicationCommandOptionType.Subcommand)
            throw new TypeError(
                "Subcommand group children must be subcommands.",
            );
        options.push(payload);
        this.data.options = options;
        return this;
    }
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

/** Base builder for application commands that appear in right-click context menus. */
class ContextMenuCommandBuilder {
    protected readonly data: Record<string, unknown>;
    public constructor(type: 2 | 3) {
        this.data = { type };
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
    /** Sets whether the command is available in direct messages. */
    public setDMPermission(enabled: boolean): this {
        this.data.dm_permission = enabled;
        return this;
    }
    /** Sets command integration types. */
    public setIntegrationTypes(...types: number[]): this {
        this.data.integration_types = [...types];
        return this;
    }
    /** Serializes the command payload for the Discord API. */
    public toJSON(): Record<string, unknown> {
        return structuredClone(this.data);
    }
}

/** Builds a User context menu command (appears when right-clicking a user, type 2).
 * @example
 * new UserCommandBuilder().setName("View Profile").toJSON()
 */
export class UserCommandBuilder extends ContextMenuCommandBuilder {
    public constructor() {
        super(2);
    }
}

/** Builds a Message context menu command (appears when right-clicking a message, type 3).
 * @example
 * new MessageCommandBuilder().setName("Translate Message").toJSON()
 */
export class MessageCommandBuilder extends ContextMenuCommandBuilder {
    public constructor() {
        super(3);
    }
}
