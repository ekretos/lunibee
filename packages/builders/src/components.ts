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
    /** Removes all row components. */ public clearComponents(): this { this.#components.length = 0; return this; }
    /** Serializes the row. */ public toJSON(): { type: typeof ComponentType.ActionRow; components: unknown[] } { return { type: ComponentType.ActionRow, components: this.#components.map(component => component.toJSON()) }; }
}

/** Builds string-select menu payloads. */
export class StringSelectBuilder {
    readonly #data: ComponentJSON = { type: ComponentType.StringSelect };
    /** Sets the custom identifier. */ public setCustomId(value: string): this { this.#data.custom_id = customId(value); return this; }
    /** Sets placeholder text. */ public setPlaceholder(value: string): this { if (value.length > 150) throw new RangeError("Component placeholder cannot exceed 150 characters."); this.#data.placeholder = value; return this; }
    /** Sets the minimum selectable value count. */ public setMinValues(value: number): this { validateCount(value, "min_values", 0); this.#data.min_values = value; this.#validateRange(); return this; }
    /** Sets the maximum selectable value count. */ public setMaxValues(value: number): this { validateCount(value, "max_values", 1); this.#data.max_values = value; this.#validateRange(); return this; }
    /** Adds string-select options. */ public addOptions(...options: Array<{ label: string; value: string; description?: string; emoji?: unknown; default?: boolean }>): this { if (!options.length) throw new TypeError("At least one select option is required."); const current = (this.#data.options as unknown[] | undefined) ?? []; if (current.length + options.length > 25) throw new RangeError("A string select cannot contain more than 25 options."); for (const option of options) { text(option.label, 100, "Select option label"); text(option.value, 100, "Select option value"); if (option.description) text(option.description, 100, "Select option description"); } this.#data.options = [...current, ...options.map(option => ({ ...option }))]; return this; }
    /** Serializes the select menu. */ public toJSON(): Record<string, unknown> { this.#validateRange(); return structuredClone(this.#data); }
    #validateRange(): void { const min = this.#data.min_values as number | undefined; const max = this.#data.max_values as number | undefined; if (min !== undefined && max !== undefined && min > max) throw new RangeError("min_values cannot exceed max_values."); }
}

/** Builds button payloads. */
export class ButtonBuilder {
    readonly #data: ComponentJSON = { type: ComponentType.Button };
    /** Sets the button style. */ public setStyle(style: number): this { if (!Number.isInteger(style) || style < 1 || style > 5) throw new RangeError("Invalid button style."); this.#data.style = style; if (style === ButtonStyle.Link) delete this.#data.custom_id; else delete this.#data.url; return this; }
    /** Sets the button custom identifier. */ public setCustomId(value: string): this { if (this.#data.style === ButtonStyle.Link) throw new RangeError("Link buttons cannot have a custom ID."); this.#data.custom_id = customId(value); return this; }
    /** Sets the visible button label. */ public setLabel(value: string): this { this.#data.label = text(value, 80, "Button label"); return this; }
    /** Sets a button URL and converts it to link style. */ public setURL(value: string): this { try { this.#data.url = new URL(value).toString(); } catch (error) { throw new TypeError("Button URL must be valid.", { cause: error }); } this.#data.style = ButtonStyle.Link; delete this.#data.custom_id; return this; }
    /** Sets the button emoji. */ public setEmoji(value: unknown): this { this.#data.emoji = value; return this; }
    /** Disables or enables the button. */ public setDisabled(value = true): this { this.#data.disabled = value; return this; }
    /** Serializes the button and validates required fields. */ public toJSON(): Record<string, unknown> { const style = this.#data.style as number | undefined; if (!style) throw new RangeError("Button style is required."); if (style === ButtonStyle.Link ? typeof this.#data.url !== "string" : typeof this.#data.custom_id !== "string") throw new RangeError(style === ButtonStyle.Link ? "Link buttons require a URL." : "Non-link buttons require a custom ID."); return structuredClone(this.#data); }
}

function customId(value: string): string { return text(value, 100, "Component custom ID"); }
function text(value: string, max: number, field: string): string { if (typeof value !== "string" || !value.trim() || value.length > max) throw new RangeError(`${field} must contain 1-${max} characters.`); return value; }
function validateCount(value: number, field: string, minimum: number): void { if (!Number.isInteger(value) || value < minimum || value > 25) throw new RangeError(`${field} must be an integer between ${minimum} and 25.`); }
