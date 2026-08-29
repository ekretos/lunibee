/** Base configuration shared by Discord application-command options. */
export interface OptionConfig {
    name: string;
    description: string;
    required?: boolean;
    autocomplete?: boolean;
}

/** Base builder for Discord application-command options. */
export class BaseOptionBuilder {
    protected readonly data: Record<string, unknown>;

    /** Creates an option builder with its Discord type. */
    public constructor(type: number) {
        this.data = { type };
    }

    /** Sets the option name. */
    public setName(value: string): this {
        validateName(value, "Option name");
        this.data.name = value;
        return this;
    }

    /** Sets the option description. */
    public setDescription(value: string): this {
        validateText(value, "Option description", 100);
        this.data.description = value;
        return this;
    }

    /** Sets whether the option is required. */
    public setRequired(value = true): this {
        if (this.data.autocomplete === true && value) throw new RangeError("Autocomplete options cannot be required when Discord requires autocomplete semantics to remain optional.");
        this.data.required = value;
        return this;
    }

    /** Enables or disables autocomplete. */
    public setAutocomplete(value = true): this {
        if (value && this.data.choices !== undefined) throw new RangeError("Autocomplete options cannot define choices.");
        this.data.autocomplete = value;
        return this;
    }

    /** Serializes the option. */
    public toJSON(): Record<string, unknown> {
        validateOption(this.data);
        return structuredClone(this.data);
    }
}

/** Builds a numeric Discord application-command option. */
export class NumberOptionBuilder extends BaseOptionBuilder {
    /** Creates a number option. */ public constructor() { super(10); }
    /** Sets the minimum numeric value. */ public setMinValue(value: number): this { finite(value, "Minimum option value"); this.data.min_value = value; this.#range(); return this; }
    /** Sets the maximum numeric value. */ public setMaxValue(value: number): this { finite(value, "Maximum option value"); this.data.max_value = value; this.#range(); return this; }
    #range(): void { const min = this.data.min_value as number | undefined; const max = this.data.max_value as number | undefined; if (min !== undefined && max !== undefined && min > max) throw new RangeError("min_value cannot exceed max_value."); }
}

/** Builds an integer Discord application-command option. */
export class IntegerOptionBuilder extends NumberOptionBuilder {
    /** Creates an integer option. */ public constructor() { super(); this.data.type = 4; }
    /** Sets the minimum integer value. */ public override setMinValue(value: number): this { if (!Number.isInteger(value)) throw new RangeError("Minimum integer option value must be an integer."); return super.setMinValue(value); }
    /** Sets the maximum integer value. */ public override setMaxValue(value: number): this { if (!Number.isInteger(value)) throw new RangeError("Maximum integer option value must be an integer."); return super.setMaxValue(value); }
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
/** Builds an attachment Discord application-command option. */
export class AttachmentOptionBuilder extends BaseOptionBuilder { /** Creates an attachment option. */ public constructor() { super(11); } }

function validateOption(data: Record<string, unknown>): void {
    if (typeof data.name !== "string" || !data.name) throw new RangeError("Option name is required.");
    if (typeof data.description !== "string" || !data.description) throw new RangeError("Option description is required.");
    if (data.autocomplete === true && data.choices !== undefined) throw new RangeError("Autocomplete options cannot define choices.");
}
function validateName(value: string, field: string): void { if (!/^[-_\p{L}\p{N}\p{sc=Deva}\p{sc=Thai}]{1,32}$/u.test(value) || value !== value.toLowerCase()) throw new RangeError(`${field} must contain 1-32 lowercase letters, numbers, underscores, or hyphens.`); }
function validateText(value: string, field: string, max: number): void { if (typeof value !== "string" || !value.trim() || value.length > max) throw new RangeError(`${field} must contain 1-${max} characters.`); }
function finite(value: number, field: string): void { if (!Number.isFinite(value)) throw new RangeError(`${field} must be finite.`); }
