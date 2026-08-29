/** Component type constants exposed by Lunibee. */
export const ComponentType = {
    ActionRow: 1,
    Button: 2,
    StringSelect: 3,
    TextInput: 4,
    UserSelect: 5,
    RoleSelect: 6,
    MentionableSelect: 7,
    ChannelSelect: 8
} as const;

/** Button appearance constants. */
export const ButtonStyle = {
    Primary: 1,
    Secondary: 2,
    Success: 3,
    Danger: 4,
    Link: 5
} as const;

interface ComponentJSON {
    type: number;
    [key: string]: unknown;
}

/** Builds an action-row component payload. */
export class ActionRowBuilder<T extends { toJSON(): unknown }> {
    readonly #components: T[] = [];

    /** Adds components to the row. */
    public addComponents(...components: T[]): this {
        if (components.length === 0) throw new TypeError("At least one component is required.");
        if (this.#components.length + components.length > 5) throw new RangeError("An action row cannot contain more than 5 components.");
        this.#components.push(...components);
        return this;
    }

    /** Serializes the row. */
    public toJSON(): { type: typeof ComponentType.ActionRow; components: unknown[] } {
        return { type: ComponentType.ActionRow, components: this.#components.map(component => component.toJSON()) };
    }
}

/** Builds string-select menu payloads. */
export class StringSelectBuilder {
    readonly #data: ComponentJSON = { type: ComponentType.StringSelect };

    /** Sets the custom identifier. */
    public setCustomId(customId: string): this {
        if (!customId.trim() || customId.length > 100) throw new RangeError("Component custom ID must contain 1-100 characters.");
        this.#data.custom_id = customId;
        return this;
    }

    /** Sets placeholder text. */
    public setPlaceholder(placeholder: string): this {
        if (placeholder.length > 150) throw new RangeError("Component placeholder cannot exceed 150 characters.");
        this.#data.placeholder = placeholder;
        return this;
    }

    /** Sets the minimum selectable value count. */
    public setMinValues(min: number): this {
        validateSelectionCount(min, "min_values", 0);
        this.#data.min_values = min;
        return this;
    }

    /** Sets the maximum selectable value count. */
    public setMaxValues(max: number): this {
        validateSelectionCount(max, "max_values", 1);
        this.#data.max_values = max;
        return this;
    }

    /** Adds string-select options. */
    public addOptions(...options: Array<{ label: string; value: string; description?: string; emoji?: unknown; default?: boolean }>): this {
        if (options.length === 0) throw new TypeError("At least one select option is required.");
        const current = (this.#data.options as unknown[] | undefined) ?? [];
        if (current.length + options.length > 25) throw new RangeError("A string select cannot contain more than 25 options.");
        for (const option of options) {
            if (!option.label || option.label.length > 100) throw new RangeError("Select option labels must contain 1-100 characters.");
            if (!option.value || option.value.length > 100) throw new RangeError("Select option values must contain 1-100 characters.");
            if (option.description && option.description.length > 100) throw new RangeError("Select option descriptions cannot exceed 100 characters.");
        }
        this.#data.options = [...current, ...options.map(option => ({ ...option }))];
        return this;
    }

    /** Serializes the select menu. */
    public toJSON(): Record<string, unknown> { return structuredClone(this.#data); }
}

/** Builds button payloads. */
export class ButtonBuilder {
    readonly #data: ComponentJSON = { type: ComponentType.Button };

    /** Sets the button style. */
    public setStyle(style: number): this {
        if (!Number.isInteger(style) || style < ButtonStyle.Primary || style > ButtonStyle.Link) throw new RangeError("Invalid button style.");
        this.#data.style = style;
        return this;
    }

    /** Sets the button custom identifier. */
    public setCustomId(customId: string): this {
        if (!customId.trim() || customId.length > 100) throw new RangeError("Button custom ID must contain 1-100 characters.");
        this.#data.custom_id = customId;
        return this;
    }

    /** Sets the visible button label. */
    public setLabel(label: string): this {
        if (label.length > 80) throw new RangeError("Button label cannot exceed 80 characters.");
        this.#data.label = label;
        return this;
    }

    /** Sets a button URL and converts the button to link style. */
    public setURL(url: string): this {
        try { this.#data.url = new URL(url).toString(); } catch { throw new TypeError("Button URL must be valid."); }
        this.#data.style = ButtonStyle.Link;
        delete this.#data.custom_id;
        return this;
    }

    /** Disables or enables the button. */
    public setDisabled(disabled = true): this { this.#data.disabled = disabled; return this; }

    /** Serializes the button. */
    public toJSON(): Record<string, unknown> { return structuredClone(this.#data); }
}

function validateSelectionCount(value: number, field: string, minimum: number): void {
    if (!Number.isInteger(value) || value < minimum || value > 25) throw new RangeError(`${field} must be an integer between ${minimum} and 25.`);
}
