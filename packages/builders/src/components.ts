/** Component type constants exposed by Lunibee. */
export const ComponentType = { ActionRow: 1, Button: 2, StringSelect: 3, TextInput: 4, UserSelect: 5, RoleSelect: 6, MentionableSelect: 7, ChannelSelect: 8 } as const;
/** Button appearance constants. */
export const ButtonStyle = { Primary: 1, Secondary: 2, Success: 3, Danger: 4, Link: 5 } as const;
/** Text input appearance constants. */
export const TextInputStyle = { Short: 1, Paragraph: 2 } as const;
/** Discord emoji payload used by components. */
export interface APIComponentEmoji { id?: string | null; name?: string | null; animated?: boolean; }
/** Strict Discord button payload. */
export interface APIButtonComponent { type: typeof ComponentType.Button; style: 1 | 2 | 3 | 4 | 5; custom_id?: string; label?: string; emoji?: APIComponentEmoji; url?: string; disabled?: boolean; }
/** Strict Discord string-select option. */
export interface APISelectOption { label: string; value: string; description?: string; emoji?: APIComponentEmoji; default?: boolean; }
/** Strict Discord string-select payload. */
export interface APIStringSelectComponent { type: typeof ComponentType.StringSelect; custom_id?: string; placeholder?: string; min_values?: number; max_values?: number; required?: boolean; options?: APISelectOption[]; }
/** Strict Discord entity-select payload. */
export interface APIEntitySelectComponent { type: typeof ComponentType.UserSelect | typeof ComponentType.RoleSelect | typeof ComponentType.MentionableSelect | typeof ComponentType.ChannelSelect; custom_id?: string; placeholder?: string; min_values?: number; max_values?: number; required?: boolean; disabled?: boolean; }
/** Strict Discord text-input payload. */
export interface APITextInputComponent { type: typeof ComponentType.TextInput; style: typeof TextInputStyle.Short | typeof TextInputStyle.Paragraph; custom_id?: string; label?: string; placeholder?: string; min_length?: number; max_length?: number; required?: boolean; value?: string; }
/** Strict Discord modal payload. */
export interface APIModalComponent { type: 9; custom_id?: string; title?: string; components: Array<{ toJSON(): unknown }>; }
/** Child component payload accepted by an action row. */
export type APIActionRowChild = APIButtonComponent | APIStringSelectComponent | APIEntitySelectComponent | APITextInputComponent;
/** Strict Discord action-row payload. */
export interface APIActionRowComponent { type: typeof ComponentType.ActionRow; components: APIActionRowChild[]; }
/** Builds action-row component payloads. */
export class ActionRowBuilder<T extends { toJSON(): APIActionRowChild } = { toJSON(): APIActionRowChild }> {
    readonly #components: T[] = [];
    /** Adds components to the action row. @param components Components to append. @returns This builder. @throws {TypeError|RangeError} When the input is invalid. */
    public addComponents(...components: T[]): this { if (!components.length) throw new TypeError("At least one component is required."); if (this.#components.length + components.length > 5) throw new RangeError("An action row cannot contain more than 5 components."); this.#components.push(...components); return this; }
    /** Clears all action-row components. @returns This builder. */
    public clearComponents(): this { this.#components.length = 0; return this; }
    /** Serializes the action row. @returns Discord action-row payload. */
    public toJSON(): APIActionRowComponent { return { type: ComponentType.ActionRow, components: this.#components.map(component => component.toJSON()) }; }
}
/** Builds string-select menus. */
export class StringSelectBuilder {
    readonly #data: APIStringSelectComponent = { type: ComponentType.StringSelect };
    /** Sets the interaction custom ID. @param value Custom ID. @returns This builder. @throws {TypeError|RangeError} When the ID is invalid. */
    public setCustomId(value: string): this { validateText(value, 100, "Component custom ID"); this.#data.custom_id = value; return this; }
    /** Sets the placeholder. @param value Placeholder text. @returns This builder. */
    public setPlaceholder(value: string): this { validateText(value, 150, "Component placeholder"); this.#data.placeholder = value; return this; }
    /** Sets the minimum number of selections. @param value Minimum count. @returns This builder. */
    public setMinValues(value: number): this { validateCount(value, "min_values", 0); this.#data.min_values = value; return this; }
    /** Sets the maximum number of selections. @param value Maximum count. @returns This builder. */
    public setMaxValues(value: number): this { validateCount(value, "max_values", 1); this.#data.max_values = value; return this; }
    /** Sets whether selection is required. @param value Requirement flag. @returns This builder. */
    public setRequired(value = true): this { this.#data.required = value; return this; }
    /** Adds select options. @param options Options to append. @returns This builder. @throws {TypeError|RangeError} When options are invalid. */
    public addOptions(...options: APISelectOption[]): this { if (!options.length) throw new TypeError("At least one select option is required."); const current = this.#data.options ?? []; if (current.length + options.length > 25) throw new RangeError("A string select cannot contain more than 25 options."); for (const option of options) { validateText(option.label, 100, "Select option label"); validateText(option.value, 100, "Select option value"); if (option.description) validateText(option.description, 100, "Select option description"); } this.#data.options = [...current, ...options.map(option => ({ ...option }))]; return this; }
    /** Serializes the select. @returns Discord string-select payload. */
    public toJSON(): APIStringSelectComponent { return structuredClone(this.#data); }
}
/** Builds button payloads. */
export class ButtonBuilder {
    readonly #data: APIButtonComponent = { type: ComponentType.Button, style: ButtonStyle.Secondary };
    /** Sets the button style. @param style Button style. @returns This builder. */
    public setStyle(style: APIButtonComponent["style"]): this { this.#data.style = style; if (style === ButtonStyle.Link) delete this.#data.custom_id; return this; }
    /** Sets an interaction custom ID. @param value Custom ID. @returns This builder. @throws {TypeError|RangeError} When invalid. */
    public setCustomId(value: string): this { validateText(value, 100, "Button custom ID"); if (this.#data.style === ButtonStyle.Link) throw new TypeError("Link buttons cannot use custom IDs."); this.#data.custom_id = value; return this; }
    /** Sets the button label. @param value Label text. @returns This builder. */
    public setLabel(value: string): this { validateText(value, 80, "Button label"); this.#data.label = value; return this; }
    /** Sets the button URL and converts the button to Link style. @param value URL. @returns This builder. @throws {TypeError|RangeError} When the URL is invalid. */
    public setURL(value: string): this { validateText(value, 512, "Button URL"); this.#data.style = ButtonStyle.Link; delete this.#data.custom_id; this.#data.url = value; return this; }
    /** Sets the button emoji. @param emoji Emoji payload. @returns This builder. */
    public setEmoji(emoji: APIComponentEmoji): this { this.#data.emoji = { ...emoji }; return this; }
    /** Sets the disabled state. @param value Disabled flag. @returns This builder. */
    public setDisabled(value = true): this { this.#data.disabled = value; return this; }
    /** Serializes the button. @returns Discord button payload. */
    public toJSON(): APIButtonComponent { return structuredClone(this.#data); }
}
/** Builds entity-select menus. */
export class EntitySelectBuilder {
    readonly #data: APIEntitySelectComponent;
    /** Creates an entity select builder. @param type Discord entity component type. */
    public constructor(type: APIEntitySelectComponent["type"]) { this.#data = { type }; }
    /** Sets the interaction custom ID. @param value Custom ID. @returns This builder. */
    public setCustomId(value: string): this { validateText(value, 100, "Component custom ID"); this.#data.custom_id = value; return this; }
    /** Sets the placeholder. @param value Placeholder text. @returns This builder. */
    public setPlaceholder(value: string): this { validateText(value, 150, "Component placeholder"); this.#data.placeholder = value; return this; }
    /** Sets the minimum selection count. @param value Minimum count. @returns This builder. */
    public setMinValues(value: number): this { validateCount(value, "min_values", 0); this.#data.min_values = value; return this; }
    /** Sets the maximum selection count. @param value Maximum count. @returns This builder. */
    public setMaxValues(value: number): this { validateCount(value, "max_values", 1); this.#data.max_values = value; return this; }
    /** Sets whether selection is required. @param value Requirement flag. @returns This builder. */
    public setRequired(value = true): this { this.#data.required = value; return this; }
    /** Sets the disabled state. @param value Disabled flag. @returns This builder. */
    public setDisabled(value = true): this { this.#data.disabled = value; return this; }
    /** Serializes the entity select. @returns Discord entity-select payload. */
    public toJSON(): APIEntitySelectComponent { return structuredClone(this.#data); }
}
/** Builds modal payloads. */
export class ModalBuilder {
    readonly #data: APIModalComponent = { type: 9, components: [] };
    /** Sets the modal custom ID. @param value Custom ID. @returns This builder. */
    public setCustomId(value: string): this { validateText(value, 100, "Modal custom ID"); this.#data.custom_id = value; return this; }
    /** Sets the modal title. @param value Title text. @returns This builder. */
    public setTitle(value: string): this { validateText(value, 45, "Modal title"); this.#data.title = value; return this; }
    /** Adds modal components. @param components Action rows to append. @returns This builder. @throws {TypeError|RangeError} When invalid. */
    public addComponents(...components: Array<{ toJSON(): unknown }>): this { if (!components.length) throw new TypeError("At least one modal component is required."); if (this.#data.components.length + components.length > 5) throw new RangeError("A modal cannot contain more than 5 action rows."); this.#data.components.push(...(components as typeof this.#data.components)); return this; }
    /** Serializes the modal. @returns Discord modal payload. */
    public toJSON(): APIModalComponent { return { type: this.#data.type, ...(this.#data.custom_id ? { custom_id: this.#data.custom_id } : {}), ...(this.#data.title ? { title: this.#data.title } : {}), components: this.#data.components.map(component => component.toJSON()) }; }
}
/** Builds text-input payloads. */
export class TextInputBuilder {
    readonly #data: APITextInputComponent = { type: ComponentType.TextInput, style: TextInputStyle.Short };
    /** Sets the text input custom ID. @param value Custom ID. @returns This builder. */
    public setCustomId(value: string): this { validateText(value, 100, "Text input custom ID"); this.#data.custom_id = value; return this; }
    /** Sets the text input style. @param style Input style. @returns This builder. */
    public setStyle(style: typeof TextInputStyle.Short | typeof TextInputStyle.Paragraph): this { this.#data.style = style; return this; }
    /** Sets the text input label. @param value Label text. @returns This builder. */
    public setLabel(value: string): this { validateText(value, 45, "Text input label"); this.#data.label = value; return this; }
    /** Sets the placeholder. @param value Placeholder text. @returns This builder. */
    public setPlaceholder(value: string): this { validateText(value, 100, "Text input placeholder"); this.#data.placeholder = value; return this; }
    /** Sets the minimum length. @param value Character count. @returns This builder. */
    public setMinLength(value: number): this { validateLength(value, "min_length"); this.#data.min_length = value; return this; }
    /** Sets the maximum length. @param value Character count. @returns This builder. */
    public setMaxLength(value: number): this { validateLength(value, "max_length", 4000); this.#data.max_length = value; return this; }
    /** Sets whether input is required. @param value Requirement flag. @returns This builder. */
    public setRequired(value = true): this { this.#data.required = value; return this; }
    /** Sets the default input value. @param value Input text. @returns This builder. @throws {RangeError} When too long. */
    public setValue(value: string): this { if (value.length > 4000) throw new RangeError("Text input value cannot exceed 4000 characters."); this.#data.value = value; return this; }
    /** Serializes the text input. @returns Discord text-input payload. */
    public toJSON(): APITextInputComponent { return structuredClone(this.#data); }
}
/** Validates a required text value. @param value Value to validate. @param max Maximum length. @param field Field name. @throws {TypeError|RangeError} When invalid. */
function validateText(value: string, max: number, field: string): void { if (typeof value !== "string") throw new TypeError(`${field} must be a string.`); if (!value.trim()) throw new RangeError(`${field} must be a non-empty string.`); if (value.length > max) throw new RangeError(`${field} cannot exceed ${max} characters.`); }
/** Validates an integer count. @param value Value to validate. @param field Field name. @param min Minimum value. @throws {RangeError} When invalid. */
function validateCount(value: number, field: string, min: number): void { if (!Number.isInteger(value) || value < min || value > 25) throw new RangeError(`${field} must be an integer between ${min} and 25.`); }
/** Validates a length value. @param value Value to validate. @param field Field name. @param max Maximum value. @throws {RangeError} When invalid. */
function validateLength(value: number, field: string, max = 4000): void { if (!Number.isInteger(value) || value < 0 || value > max) throw new RangeError(`${field} must be an integer between 0 and ${max}.`); }
