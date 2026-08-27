/** Builds Discord application command payloads. */
export class SlashCommandBuilder {
    readonly #data: Record<string, unknown> = { type: 1 };
    /** Sets the command name. */
    public setName(name: string): this { this.#data.name = name; return this; }
    /** Sets the command description. */
    public setDescription(description: string): this { this.#data.description = description; return this; }
    /** Marks the command as usable only in direct messages. */
    public setDMPermission(value: boolean): this { this.#data.dm_permission = value; return this; }
    /** Adds a string option. */
    public addStringOption(configure: (option: StringOptionBuilder) => StringOptionBuilder): this {
        const option = configure(new StringOptionBuilder());
        this.#data.options = [...((this.#data.options as unknown[]) ?? []), option.toJSON()];
        return this;
    }
    /** Returns the Discord API representation. */
    public toJSON(): Record<string, unknown> { return structuredClone(this.#data); }
}

/** Builds a string application-command option. */
export class StringOptionBuilder {
    readonly #data: Record<string, unknown> = { type: 3 };
    /** Sets the option name. */
    public setName(name: string): this { this.#data.name = name; return this; }
    /** Sets the option description. */
    public setDescription(description: string): this { this.#data.description = description; return this; }
    /** Makes the option required. */
    public setRequired(required = true): this { this.#data.required = required; return this; }
    /** Adds a choice. */
    public addChoices(...choices: Array<{ name: string; value: string }>): this { this.#data.choices = [...((this.#data.choices as unknown[]) ?? []), ...choices]; return this; }
    /** Returns the Discord API representation. */
    public toJSON(): Record<string, unknown> { return structuredClone(this.#data); }
}
