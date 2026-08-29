/** Component type constants exposed by Lunibee. */
export const ComponentType = { ActionRow: 1, Button: 2, StringSelect: 3, TextInput: 4, UserSelect: 5, RoleSelect: 6, MentionableSelect: 7, ChannelSelect: 8 } as const;
/** Button appearance constants. */
export const ButtonStyle = { Primary: 1, Secondary: 2, Success: 3, Danger: 4, Link: 5 } as const;
/** Text input appearance constants. */
export const TextInputStyle = { Short: 1, Paragraph: 2 } as const;
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
    public setCustomId(value: string): this { validateText(value, 100, "Component custom ID"); this.#data.custom_id = value; return this; }
    /** Sets placeholder text. */
    public setPlaceholder(value: string): this { validateText(value, 150, "Component placeholder"); this.#data.placeholder = value; return this; }
    /** Sets the minimum selectable value count. */
    public setMinValues(value: number): this { validateCount(value, "min_values", 0); this.#data.min_values = value; return this; }
    /** Sets the maximum selectable value count. */
    public setMaxValues(value: number): this { validateCount(value, "max_values", 1); this.#data.max_values = value; return this; }
    /** Sets whether the component is required. */
    public setRequired(value = true): this { this.#data.required = value; return this; }
    /** Adds string-select options. */
    public addOptions(...options: Array<{ label: string; value: string; description?: string; emoji?: unknown; default?: boolean }>): this { if (!options.length) throw new TypeError("At least one select option is required."); const current = (this.#data.options as unknown[] | undefined) ?? []; if (current.length + options.length > 25) throw new RangeError("A string select cannot contain more than 25 options."); for (const option of options) { validateText(option.label, 100, "Select option label"); validateText(option.value, 100, "Select option value"); if (option.description) validateText(option.description, 100, "Select option description"); } this.#data.options = [...current, ...options.map(option => ({ ...option }))]; return this; }
    /** Serializes the select menu. */
    public toJSON(): Record<string, unknown> { return structuredClone(this.#data); }
}

/** Builds user, role, mentionable, and channel select menus. */
export class EntitySelectBuilder {
    readonly #data: ComponentJSON;
    /** Creates an entity select builder. */
    public constructor(type: typeof ComponentType.UserSelect | typeof ComponentType.RoleSelect | typeof ComponentType.MentionableSelect | typeof ComponentType.ChannelSelect) { this.#data = { type }; }
    /** Sets the custom identifier. */
    public setCustomId(value: string): this { validateText(value, 100, "Component custom ID"); this.#data.custom_id = value; return this; }
    /** Sets placeholder text. */
    public setPlaceholder(value: string): this { validateText(value, 150, "Component placeholder"); this.#data.placeholder = value; return this; }
    /** Sets minimum selections. */
    public setMinValues(value: number): this { validateCount(value, "min_values", 0); this.#data.min_values = value; return this; }
    /** Sets maximum selections. */
    public setMaxValues(value: number): this { validateCount(value, "max_values", 1); this.#data.max_values = value; return this; }
    /** Sets the required flag. */
    public setRequired(value = true): this { this.#data.required = value; return this; }
    /** Sets the disabled flag. */
    public setDisabled(value = true): this { this.#data.disabled = value; return this; }
    /** Serializes the entity select. */
    public toJSON(): Record<string, unknown> { return structuredClone(this.#data); }
}

/** Builds button payloads. */
export class ButtonBuilder {
    readonly #data: ComponentJSON = { type: ComponentType.Button };
    /** Sets the button style. */
    public setStyle(style: number): this { if (!Number.isInteger(style) || style < 1 || style > 5) throw new RangeError("Invalid button style."); this.#data.style = style; return this; }
    /** Sets the button custom identifier. */
    public setCustomId(value: string): this { validateText(value, 100, "Button custom ID"); this.#data.custom_id = value; delete this.#data.url; return this; }
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

/** Builds modal payloads. */
export class ModalBuilder {
    readonly #data: ComponentJSON = { type: 9, components: [] };
    /** Sets the modal custom identifier. */
    public setCustomId(value: string): this { validateText(value, 100, "Modal custom ID"); this.#data.custom_id = value; return this; }
    /** Sets the modal title. */
    public setTitle(value: string): this { validateText(value, 45, "Modal title"); this.#data.title = value; return this; }
    /** Adds one or more modal components. */
    public addComponents(...components: Array<{ toJSON(): unknown }>): this { if (!components.length) throw new TypeError("At least one modal component is required."); const current = this.#data.components as unknown[]; if (current.length + components.length > 5) throw new RangeError("A modal cannot contain more than 5 action rows."); current.push(...components.map(component => component.toJSON())); return this; }
    /** Serializes the modal. */
    public toJSON(): Record<string, unknown> { return structuredClone(this.#data); }
}

/** Builds text-input payloads for modal action rows. */
export class TextInputBuilder {
    readonly #data: ComponentJSON = { type: ComponentType.TextInput, style: TextInputStyle.Short };
    /** Sets the custom identifier. */
    public setCustomId(value: string): this { validateText(value, 100, "Text input custom ID"); this.#data.custom_id = value; return this; }
    /** Sets the text input style. */
    public setStyle(style: typeof TextInputStyle.Short | typeof TextInputStyle.Paragraph): this { if (style !== 1 && style !== 2) throw new RangeError("Invalid text input style."); this.#data.style = style; return this; }
    /** Sets the text input label. */
    public setLabel(value: string): this { validateText(value, 45, "Text input label"); this.#data.label = value; return this; }
    /** Sets placeholder text. */
    public setPlaceholder(value: string): this { if (value.length > 100) throw new RangeError("Text input placeholder cannot exceed 100 characters."); this.#data.placeholder = value; return this; }
    /** Sets the minimum text length. */
    public setMinLength(value: number): this { validateLength(value, "min_length"); this.#data.min_length = value; return this; }
    /** Sets the maximum text length. */
    public setMaxLength(value: number): this { validateLength(value, "max_length", 4000); this.#data.max_length = value; return this; }
    /** Sets whether the input is required. */
    public setRequired(value = true): this { this.#data.required = value; return this; }
    /** Sets the initial value. */
    public setValue(value: string): this { if (value.length > 4000) throw new RangeError("Text input value cannot exceed 4000 characters."); this.#data.value = value; return this; }
    /** Serializes the text input. */
    public toJSON(): Record<string, unknown> { return structuredClone(this.#data); }
}

function validateText(value: string, max: number, name: string): void { if (typeof value !== "string" || !value.trim() || value.length > max) throw new RangeError(`${name} must contain 1-${max} characters.`); }
function validateCount(value: number, field: string, minimum: number): void { if (!Number.isInteger(value) || value < minimum || value > 25) throw new RangeError(`${field} must be an integer between ${minimum} and 25.`); }
function validateLength(value: number, field: string, maximum = 1000): void { if (!Number.isInteger(value) || value < 0 || value > maximum) throw new RangeError(`${field} must be an integer between 0 and ${maximum}.`); }
