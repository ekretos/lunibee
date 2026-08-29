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
    public setDefaultMemberPermissions(permissions: bigint | number | string | null): this {
        this.#data.default_member_permissions = permissions === null ? null : BigInt(permissions).toString();
        return this;
    }
    /** Adds a string option. */
    public addStringOption(configure: (option: StringOptionBuilder) => StringOptionBuilder): this {
        const option = configure(new StringOptionBuilder());
        if (!(option instanceof StringOptionBuilder)) throw new TypeError("String option configurator must return its builder.");
        const options = (this.#data.options as unknown[] | undefined) ?? [];
        if (options.length >= 25) throw new RangeError("An application command cannot contain more than 25 options.");
        options.push(option.toJSON());
        this.#data.options = options;
        return this;
    }
    /** Serializes the command payload. */
    public toJSON(): Record<string, unknown> { return structuredClone(this.#data); }
}

/** Builds a string application-command option. */
export class StringOptionBuilder {
    readonly #data: Record<string, unknown> = { type: 3 };

    /** Sets the option name. */
    public setName(name: string): this { validateName(name, "Option name"); this.#data.name = name; return this; }
    /** Sets the option description. */
    public setDescription(description: string): this { validateText(description, "Option description", 100); this.#data.description = description; return this; }
    /** Makes the option required or optional. */
    public setRequired(required = true): this { this.#data.required = required; return this; }
    /** Sets the autocomplete flag. */
    public setAutocomplete(enabled = true): this { this.#data.autocomplete = enabled; return this; }
    /** Adds string choices. */
    public addChoices(...choices: Array<{ name: string; value: string }>): this {
        if (choices.length === 0) throw new TypeError("At least one choice is required.");
        const current = (this.#data.choices as unknown[] | undefined) ?? [];
        if (current.length + choices.length > 25) throw new RangeError("A string option cannot contain more than 25 choices.");
        for (const choice of choices) {
            validateText(choice.name, "Choice name", 100);
            validateText(choice.value, "Choice value", 100);
        }
        this.#data.choices = [...current, ...choices.map(choice => ({ ...choice }))];
        return this;
    }
    /** Serializes the option payload. */
    public toJSON(): Record<string, unknown> { return structuredClone(this.#data); }
}

function validateName(value: string, field: string): void {
    if (!/^[\p{L}\p{N}_-]{1,32}$/u.test(value)) throw new RangeError(`${field} must contain 1-32 letters, numbers, underscores, or hyphens.`);
}

function validateText(value: string, field: string, max: number): void {
    if (typeof value !== "string" || !value.trim() || value.length > max) throw new RangeError(`${field} must contain 1-${max} characters.`);
}
