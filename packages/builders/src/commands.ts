/** Discord application command option types. */
export const ApplicationCommandOptionType = { Subcommand: 1, SubcommandGroup: 2, String: 3, Integer: 4, Boolean: 5, User: 6, Channel: 7, Role: 8, Mentionable: 9, Number: 10, Attachment: 11 } as const;

/** Builds Discord application command payloads. */
export class SlashCommandBuilder {
    readonly #data: Record<string, unknown> = { type: 1 };
    /** Sets the command name. */ public setName(name: string): this { validateName(name, "Command name"); this.#data.name = name; return this; }
    /** Sets the command description. */ public setDescription(description: string): this { validateText(description, "Command description", 100); this.#data.description = description; return this; }
    /** Sets whether the command is available in direct messages. */ public setDMPermission(value: boolean): this { this.#data.dm_permission = value; return this; }
    /** Sets command default member permissions. */ public setDefaultMemberPermissions(permissions: bigint | number | string | null): this { this.#data.default_member_permissions = permissions === null ? null : BigInt(permissions).toString(); return this; }
    /** Sets command integration types. */ public setIntegrationTypes(...types: number[]): this { this.#data.integration_types = [...types]; return this; }
    /** Adds a string option. */ public addStringOption(configure: (option: StringOptionBuilder) => StringOptionBuilder): this { return this.addOption(configure(new StringOptionBuilder())); }
    /** Adds an integer option. */ public addIntegerOption(configure: (option: IntegerOptionBuilder) => IntegerOptionBuilder): this { return this.addOption(configure(new IntegerOptionBuilder())); }
    /** Adds a number option. */ public addNumberOption(configure: (option: NumberOptionBuilder) => NumberOptionBuilder): this { return this.addOption(configure(new NumberOptionBuilder())); }
    /** Adds a boolean option. */ public addBooleanOption(configure: (option: BooleanOptionBuilder) => BooleanOptionBuilder): this { return this.addOption(configure(new BooleanOptionBuilder())); }
    /** Adds a user option. */ public addUserOption(configure: (option: UserOptionBuilder) => UserOptionBuilder): this { return this.addOption(configure(new UserOptionBuilder())); }
    /** Adds a channel option. */ public addChannelOption(configure: (option: ChannelOptionBuilder) => ChannelOptionBuilder): this { return this.addOption(configure(new ChannelOptionBuilder())); }
    /** Adds a role option. */ public addRoleOption(configure: (option: RoleOptionBuilder) => RoleOptionBuilder): this { return this.addOption(configure(new RoleOptionBuilder())); }
    /** Adds a mentionable option. */ public addMentionableOption(configure: (option: MentionableOptionBuilder) => MentionableOptionBuilder): this { return this.addOption(configure(new MentionableOptionBuilder())); }
    /** Adds an attachment option. */ public addAttachmentOption(configure: (option: AttachmentOptionBuilder) => AttachmentOptionBuilder): this { return this.addOption(configure(new AttachmentOptionBuilder())); }
    /** Adds a subcommand. */ public addSubcommand(configure: (option: SubcommandBuilder) => SubcommandBuilder): this { return this.addOption(configure(new SubcommandBuilder())); }
    /** Adds a subcommand group. */ public addSubcommandGroup(configure: (option: SubcommandGroupBuilder) => SubcommandGroupBuilder): this { return this.addOption(configure(new SubcommandGroupBuilder())); }
    /** Serializes the command payload. */ public toJSON(): Record<string, unknown> { return structuredClone(this.#data); }
    private addOption(option: { toJSON(): Record<string, unknown> }): this { const options = (this.#data.options as unknown[] | undefined) ?? []; if (options.length >= 25) throw new RangeError("An application command cannot contain more than 25 options."); options.push(option.toJSON()); this.#data.options = options; return this; }
}

/** Base builder for command options. */
class CommandOptionBuilder {
    protected readonly data: Record<string, unknown>;
    /** Creates an option builder. */
    public constructor(type: number) { this.data = { type }; }
    /** Sets the option name. */ public setName(name: string): this { validateName(name, "Option name"); this.data.name = name; return this; }
    /** Sets the option description. */ public setDescription(description: string): this { validateText(description, "Option description", 100); this.data.description = description; return this; }
    /** Makes the option required or optional. */ public setRequired(required = true): this { this.data.required = required; return this; }
    /** Sets autocomplete. */ public setAutocomplete(enabled = true): this { this.data.autocomplete = enabled; return this; }
    /** Serializes the option payload. */ public toJSON(): Record<string, unknown> { return structuredClone(this.data); }
}

/** Builds a string command option. */
export class StringOptionBuilder extends CommandOptionBuilder {
    /** Creates a string option. */ public constructor() { super(ApplicationCommandOptionType.String); }
    /** Adds string choices. */ public addChoices(...choices: Array<{ name: string; value: string }>): this { const current = (this.data.choices as unknown[] | undefined) ?? []; if (!choices.length) throw new TypeError("At least one choice is required."); if (current.length + choices.length > 25) throw new RangeError("An option cannot contain more than 25 choices."); for (const choice of choices) { validateText(choice.name, "Choice name", 100); validateText(choice.value, "Choice value", 100); } this.data.choices = [...current, ...choices.map(choice => ({ ...choice }))]; return this; }
    /** Sets the minimum string length. */ public setMinLength(value: number): this { validateRange(value, 0, 6000, "min_length"); this.data.min_length = value; return this; }
    /** Sets the maximum string length. */ public setMaxLength(value: number): this { validateRange(value, 1, 6000, "max_length"); this.data.max_length = value; return this; }
}
/** Builds an integer command option. */
export class IntegerOptionBuilder extends CommandOptionBuilder { /** Creates an integer option. */ public constructor() { super(ApplicationCommandOptionType.Integer); } /** Sets minimum value. */ public setMinValue(value: number): this { validateRange(value, -2_147_483_648, 2_147_483_647, "min_value"); this.data.min_value = value; return this; } /** Sets maximum value. */ public setMaxValue(value: number): this { validateRange(value, -2_147_483_648, 2_147_483_647, "max_value"); this.data.max_value = value; return this; } }
/** Builds a number command option. */
export class NumberOptionBuilder extends CommandOptionBuilder { /** Creates a number option. */ public constructor() { super(ApplicationCommandOptionType.Number); } /** Sets minimum value. */ public setMinValue(value: number): this { if (!Number.isFinite(value)) throw new RangeError("min_value must be finite."); this.data.min_value = value; return this; } /** Sets maximum value. */ public setMaxValue(value: number): this { if (!Number.isFinite(value)) throw new RangeError("max_value must be finite."); this.data.max_value = value; return this; } }
/** Builds a boolean command option. */ export class BooleanOptionBuilder extends CommandOptionBuilder { /** Creates a boolean option. */ public constructor() { super(ApplicationCommandOptionType.Boolean); } }
/** Builds a user command option. */ export class UserOptionBuilder extends CommandOptionBuilder { /** Creates a user option. */ public constructor() { super(ApplicationCommandOptionType.User); } }
/** Builds a role command option. */ export class RoleOptionBuilder extends CommandOptionBuilder { /** Creates a role option. */ public constructor() { super(ApplicationCommandOptionType.Role); } }
/** Builds a mentionable command option. */ export class MentionableOptionBuilder extends CommandOptionBuilder { /** Creates a mentionable option. */ public constructor() { super(ApplicationCommandOptionType.Mentionable); } }
/** Builds an attachment command option. */ export class AttachmentOptionBuilder extends CommandOptionBuilder { /** Creates an attachment option. */ public constructor() { super(ApplicationCommandOptionType.Attachment); } }
/** Builds a channel command option. */ export class ChannelOptionBuilder extends CommandOptionBuilder {
    /** Creates a channel option. */ public constructor() { super(ApplicationCommandOptionType.Channel); }
    /** Restricts accepted channel types. */ public addChannelTypes(...types: number[]): this { this.data.channel_types = [...new Set(types)]; return this; }
}
/** Builds a nested subcommand. */ export class SubcommandBuilder extends CommandOptionBuilder { /** Creates a subcommand. */ public constructor() { super(ApplicationCommandOptionType.Subcommand); } }
/** Builds a nested subcommand group. */ export class SubcommandGroupBuilder extends CommandOptionBuilder { /** Creates a subcommand group. */ public constructor() { super(ApplicationCommandOptionType.SubcommandGroup); } }

function validateName(value: string, field: string): void { if (!/^[\p{L}\p{N}_-]{1,32}$/u.test(value)) throw new RangeError(`${field} must contain 1-32 letters, numbers, underscores, or hyphens.`); }
function validateText(value: string, field: string, max: number): void { if (typeof value !== "string" || !value.trim() || value.length > max) throw new RangeError(`${field} must contain 1-${max} characters.`); }
function validateRange(value: number, minimum: number, maximum: number, field: string): void { if (!Number.isInteger(value) || value < minimum || value > maximum) throw new RangeError(`${field} must be an integer between ${minimum} and ${maximum}.`); }
