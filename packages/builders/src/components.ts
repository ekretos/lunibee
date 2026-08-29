/** Component type constants exposed by Lunibee. */
export const ComponentType = { ActionRow: 1, Button: 2, StringSelect: 3, TextInput: 4, UserSelect: 5, RoleSelect: 6, MentionableSelect: 7, ChannelSelect: 8 } as const;
/** Button appearance constants. */
export const ButtonStyle = { Primary: 1, Secondary: 2, Success: 3, Danger: 4, Link: 5 } as const;
interface ComponentJSON { type: number; [key: string]: unknown; }

/** Builds an action-row component payload. */
export class ActionRowBuilder<T extends { toJSON(): unknown }> {
    readonly #components: T[] = [];
    /** Adds components to the row. */
    public addComponents(...components: T[]): this { if (!components.length) throw new TypeError("At least one component is required."); if (this.#components.length + components.length > 5) throw new RangeError("An action row cannot contain more than 5 components."); this.#components.push(...components); return this; }
    /** Removes all row components. */
    public clearComponents(): this { this.#components.length = 0; return this; }
    /** Serializes the row. */
    public toJSON(): { type: typeof ComponentType.ActionRow; components: unknown[] } { return { type: ComponentType.ActionRow, components: this.#components.map(component => component.toJSON()) }; }
}

/** Builds string-select menu payloads. */
export class StringSelectBuilder {
    readonly #data: ComponentJSON = { type: ComponentType.StringSelect };
    /** Sets the custom identifier. */
    public setCustomId(value: string): this { if (!value.trim() || value.length > 100) throw new RangeError("Component custom ID must contain 1-100 characters."); this.#data.custom_id = value; return this; }
    /** Sets placeholder text. */
    public setPlaceholder(value: string): this { if (value.length > 150) throw new RangeError("Component placeholder cannot exceed 150 characters."); this.#data.placeholder = value; return this; }
    /** Sets the minimum selectable value count. */
    public setMinValues(value: number): this { validateCount(value, "min_values", 0); this.#data.min_values = value; return this; }
    /** Sets the maximum selectable value count. */
    public setMaxValues(value: number): this { validateCount(value, "max_values", 1); this.#data.max_values = value; return this; }
    /** Sets whether multiple values can be selected. */
    public setRequired(value = true): this { this.#data.required = value; return this; }
    /** Adds string-select options. */
    public addOptions(...options: Array<{ label: string; value: string; description?: string; emoji?: unknown; default?: boolean }>): this { if (!options.length) throw new TypeError("At least one select option is required."); const current = (this.#data.options as unknown[] | undefined) ?? []; if (current.length + options.length > 25) throw new RangeError("A string select cannot contain more than 25 options."); for (const option of options) { if (!option.label || option.label.length > 100) throw new RangeError("Select option labels must contain 1-100 characters."); if (!option.value || option.value.length > 100) throw new RangeError("Select option values must contain 1-100 characters."); if (option.description && option.description.length > 100) throw new RangeError("Select option descriptions cannot exceed 100 characters."); } this.#data.options = [...current, ...options.map(option => ({ ...option }))]; return this; }
    /** Serializes the select menu. */
    public toJSON(): Record<string, unknown> { return structuredClone(this.#data); }
}

/** Builds button payloads. */
export class ButtonBuilder {
    readonly #data: ComponentJSON = { type: ComponentType.Button };
    /** Sets the button style. */
    public setStyle(style: number): this { if (!Number.isInteger(style) || style < 1 || style > 5) throw new RangeError("Invalid button style."); this.#data.style = style; return this; }
    /** Sets the button custom identifier. */
    public setCustomId(value: string): this { if (!value.trim() || value.length > 100) throw new RangeError("Button custom ID must contain 1-100 characters."); this.#data.custom_id = value; delete this.#data.url; return this; }
    /** Sets the visible button label. */
    public setLabel(value: string): this { if (value.length > 80) throw new RangeError("Button label cannot exceed 80 characters."); this.#data.label = value; return this; }
    /** Sets a button URL and converts it to link style. */
    public setURL(value: string): this { try { this.#data.url = new URL(value).toString(); } catch (error) { throw new TypeError("Button URL must be valid.", { cause: error }); } this.#data.style = ButtonStyle.Link; delete this.#data.custom_id; return this; }
    /** Sets the button emoji. */
    public setEmoji(value: unknown): this { this.#data.emoji = value; return this; }
    /** Disables or enables the button. */
    public setDisabled(value = true): this { this.#data.disabled = value; return this; }
    /** Serializes the button. */
    public toJSON(): Record<string, unknown> { return structuredClone(this.#data); }
}

function validateCount(value: number, field: string, minimum: number): void { if (!Number.isInteger(value) || value < minimum || value > 25) throw new RangeError(`${field} must be an integer between ${minimum} and 25.`); }
