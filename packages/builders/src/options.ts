/** Base configuration shared by Discord application-command options. */
export interface OptionConfig { name: string; description: string; required?: boolean; autocomplete?: boolean; }

/** Base builder for Discord application-command options. */
export class BaseOptionBuilder {
    protected readonly data: Record<string, unknown>;
    /** Creates an option builder with its Discord type. */
    public constructor(type: number) { this.data = { type }; }
    /** Sets the option name. */
    public setName(value: string): this { validateName(value, "Option name"); this.data.name = value; return this; }
    /** Sets the option description. */
    public setDescription(value: string): this { validateText(value, "Option description", 100); this.data.description = value; return this; }
    /** Sets whether the option is required. */
    public setRequired(value = true): this { this.data.required = value; return this; }
    /** Enables or disables autocomplete. */
    public setAutocomplete(value = true): this { this.data.autocomplete = value; return this; }
    /** Serializes the option. */
    public toJSON(): Record<string, unknown> { return structuredClone(this.data); }
}

/** Builds a numeric Discord application-command option. */
export class NumberOptionBuilder extends BaseOptionBuilder {
    /** Creates a number option. */
    public constructor() { super(10); }
    /** Sets the minimum numeric value. */
    public setMinValue(value: number): this { if (!Number.isFinite(value)) throw new RangeError("Minimum option value must be finite."); this.data.min_value = value; return this; }
    /** Sets the maximum numeric value. */
    public setMaxValue(value: number): this { if (!Number.isFinite(value)) throw new RangeError("Maximum option value must be finite."); this.data.max_value = value; return this; }
}

/** Builds a boolean Discord application-command option. */
export class BooleanOptionBuilder extends BaseOptionBuilder { /** Creates a boolean option. */ public constructor() { super(5); } }
/** Builds a user Discord application-command option. */
export class UserOptionBuilder extends BaseOptionBuilder { /** Creates a user option. */ public constructor() { super(6); } }
/** Builds a channel Discord application-command option. */
export class ChannelOptionBuilder extends BaseOptionBuilder { /** Creates a channel option. */ public constructor() { super(7); } }
/** Builds a role Discord application-command option. */
export class RoleOptionBuilder extends BaseOptionBuilder { /** Creates a role option. */ public constructor() { super(8); } }
/** Builds a mentionable Discord application-command option. */
export class MentionableOptionBuilder extends BaseOptionBuilder { /** Creates a mentionable option. */ public constructor() { super(9); } }

function validateName(value: string, field: string): void { if (!/^[\p{L}\p{N}_-]{1,32}$/u.test(value)) throw new RangeError(`${field} must contain 1-32 letters, numbers, underscores, or hyphens.`); }
function validateText(value: string, field: string, max: number): void { if (typeof value !== "string" || !value.trim() || value.length > max) throw new RangeError(`${field} must contain 1-${max} characters.`); }
