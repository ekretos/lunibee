/** Discord component type constants. */
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

/** Discord button style constants. */
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

/** Builds a Discord action row from component builders. */
export class ActionRowBuilder<T extends { toJSON(): unknown }> {
    readonly #components: T[] = [];

    /** Adds one or more components to the row. */
    public addComponents(...components: T[]): this {
        if (components.length === 0) throw new TypeError("At least one component is required.");
        this.#components.push(...components);
        return this;
    }

    /** Returns the serialized Discord payload. */
    public toJSON(): { type: typeof ComponentType.ActionRow; components: unknown[] } {
        return {
            type: ComponentType.ActionRow,
            components: this.#components.map(component => component.toJSON())
        };
    }
}

/** Builds Discord string-select menu components. */
export class StringSelectBuilder {
    readonly #data: ComponentJSON = { type: ComponentType.StringSelect };

    /** Sets the component custom ID. */
    public setCustomId(customId: string): this {
        if (!customId.trim()) throw new TypeError("A component custom ID is required.");
        this.#data.custom_id = customId;
        return this;
    }

    /** Sets the placeholder text. */
    public setPlaceholder(placeholder: string): this {
        this.#data.placeholder = placeholder;
        return this;
    }

    /** Sets the minimum number of selectable values. */
    public setMinValues(min: number): this {
        if (!Number.isInteger(min) || min < 0 || min > 25) throw new RangeError("min_values must be an integer between 0 and 25.");
        this.#data.min_values = min;
        return this;
    }

    /** Sets the maximum number of selectable values. */
    public setMaxValues(max: number): this {
        if (!Number.isInteger(max) || max < 1 || max > 25) throw new RangeError("max_values must be an integer between 1 and 25.");
        this.#data.max_values = max;
        return this;
    }

    /** Adds options to the select menu. */
    public addOptions(...options: Array<{
        label: string;
        value: string;
        description?: string;
        emoji?: unknown;
        default?: boolean;
    }>): this {
        if (options.length === 0) throw new TypeError("At least one select option is required.");
        const current = (this.#data.options as unknown[] | undefined) ?? [];
        if (current.length + options.length > 25) throw new RangeError("A string select cannot contain more than 25 options.");
        this.#data.options = [...current, ...options];
        return this;
    }

    /** Returns an immutable snapshot of the Discord payload. */
    public toJSON(): Record<string, unknown> {
        return structuredClone(this.#data);
    }
}
