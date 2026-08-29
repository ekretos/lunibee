import { AttachmentOptionBuilder, BaseOptionBuilder, BooleanOptionBuilder, ChannelOptionBuilder, IntegerOptionBuilder, MentionableOptionBuilder, NumberOptionBuilder, RoleOptionBuilder, UserOptionBuilder } from "./options.js";

/** Builds Discord application command payloads. */
export class SlashCommandBuilder {
    readonly #data: Record<string, unknown> = { type: 1 };

    /** Sets the command name. */
    public setName(name: string): this { validateName(name, "Command name"); this.#data.name = name; return this; }
    /** Sets the command description. */
    public setDescription(description: string): this { validateText(description, "Command description", 100); this.#data.description = description; return this; }
    /** Sets whether the command is available in direct messages. */
    public setDMPermission(value: boolean): this { this.#data.dm_permission = value; return this; }
    /** Sets command default member permissions. */
    public setDefaultMemberPermissions(permissions: bigint | number | string | null): this { this.#data.default_member_permissions = permissions === null ? null : BigInt(permissions).toString(); return this; }
    /** Adds a string option. */
    public addStringOption(configure: (option: StringOptionBuilder) => StringOptionBuilder): this { return this.#addOption(configure(new StringOptionBuilder())); }
    /** Adds a numeric option. */
    public addNumberOption(configure: (option: NumberOptionBuilder) => NumberOptionBuilder): this { return this.#addOption(configure(new NumberOptionBuilder())); }
    /** Adds an integer option. */
    public addIntegerOption(configure: (option: IntegerOptionBuilder) => IntegerOptionBuilder): this { return this.#addOption(configure(new IntegerOptionBuilder())); }
    /** Adds a boolean option. */
    public addBooleanOption(configure: (option: BooleanOptionBuilder) => BooleanOptionBuilder): this { return this.#addOption(configure(new BooleanOptionBuilder())); }
    /** Adds a user option. */
    public addUserOption(configure: (option: UserOptionBuilder) => UserOptionBuilder): this { return this.#addOption(configure(new UserOptionBuilder())); }
    /** Adds a channel option. */
    public addChannelOption(configure: (option: ChannelOptionBuilder) => ChannelOptionBuilder): this { return this.#addOption(configure(new ChannelOptionBuilder())); }
    /** Adds a role option. */
    public addRoleOption(configure: (option: RoleOptionBuilder) => RoleOptionBuilder): this { return this.#addOption(configure(new RoleOptionBuilder())); }
    /** Adds a mentionable option. */
    public addMentionableOption(configure: (option: MentionableOptionBuilder) => MentionableOptionBuilder): this { return this.#addOption(configure(new MentionableOptionBuilder())); }
    /** Adds an attachment option. */
    public addAttachmentOption(configure: (option: AttachmentOptionBuilder) => AttachmentOptionBuilder): this { return this.#addOption(configure(new AttachmentOptionBuilder())); }
    /** Serializes the command payload. */
    public toJSON(): Record<string, unknown> { return structuredClone(this.#data); }

    #addOption(option: BaseOptionBuilder): this {
        const options = (this.#data.options as Array<Record<string, unknown>> | undefined) ?? [];
        if (options.length >= 25) throw new RangeError("An application command cannot contain more than 25 options.");
        const payload = option.toJSON();
        validateOptionForAppend(options, payload);
        options.push(payload);
        this.#data.options = options;
        return this;
    }
}

/** Builds a string application-command option. */
export class StringOptionBuilder extends BaseOptionBuilder {
    /** Creates a string option. */ public constructor() { super(3); }
    /** Adds string choices. */
    public addChoices(...choices: Array<{ name: string; value: string }>): this {
        if (!choices.length) throw new TypeError("At least one choice is required.");
        if (this.data.autocomplete === true) throw new RangeError("Autocomplete options cannot define choices.");
        const current = (this.data.choices as unknown[] | undefined) ?? [];
        if (current.length + choices.length > 25) throw new RangeError("A string option cannot contain more than 25 choices.");
        for (const choice of choices) { validateText(choice.name, "Choice name", 100); validateText(choice.value, "Choice value", 100); }
        this.data.choices = [...current, ...choices.map(choice => ({ ...choice }))];
        return this;
    }
}

function validateOptionForAppend(options: Array<Record<string, unknown>>, option: Record<string, unknown>): void {
    if (typeof option.name !== "string" || !option.name) throw new RangeError("Option name is required.");
    if (typeof option.description !== "string" || !option.description) throw new RangeError("Option description is required.");
    if (options.some(existing => existing.name === option.name)) throw new RangeError(`Duplicate option name: ${option.name}.`);
    if (option.required === true && options.some(existing => existing.required !== true)) throw new RangeError("Required application command options must be placed before optional options.");
}
function validateName(value: string, field: string): void { if (!/^[-_\p{L}\p{N}\p{sc=Deva}\p{sc=Thai}]{1,32}$/u.test(value) || value !== value.toLowerCase()) throw new RangeError(`${field} must contain 1-32 lowercase letters, numbers, underscores, or hyphens.`); }
function validateText(value: string, field: string, max: number): void { if (typeof value !== "string" || !value.trim() || value.length > max) throw new RangeError(`${field} must contain 1-${max} characters.`); }
