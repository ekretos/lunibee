/** Component type constants exposed by Lunibee. */
export const ComponentType = { ActionRow: 1, Button: 2, StringSelect: 3, TextInput: 4, UserSelect: 5, RoleSelect: 6, MentionableSelect: 7, ChannelSelect: 8 } as const;
/** Button appearance constants. */
export const ButtonStyle = { Primary: 1, Secondary: 2, Success: 3, Danger: 4, Link: 5 } as const;
/** Text input appearance constants. */
export const TextInputStyle = { Short: 1, Paragraph: 2 } as const;
/** Discord emoji payload used by components. */
export interface APIComponentEmoji { /** Emoji identifier. */ id?: string | null; /** Emoji name. */ name?: string | null; /** Animated state. */ animated?: boolean; }
/** Strict Discord button payload. */
export interface APIButtonComponent { /** Component discriminator. */ type: typeof ComponentType.Button; /** Button style. */ style: 1 | 2 | 3 | 4 | 5; /** Custom identifier. */ custom_id?: string; /** Visible label. */ label?: string; /** Emoji payload. */ emoji?: APIComponentEmoji; /** Link URL. */ url?: string; /** Disabled state. */ disabled?: boolean; }
/** Strict Discord string-select option. */
export interface APISelectOption { /** Visible label. */ label: string; /** Submitted value. */ value: string; /** Optional description. */ description?: string; /** Optional emoji. */ emoji?: APIComponentEmoji; /** Default selection state. */ default?: boolean; }
/** Strict Discord string-select payload. */
export interface APIStringSelectComponent { /** Component discriminator. */ type: typeof ComponentType.StringSelect; /** Custom identifier. */ custom_id?: string; /** Placeholder. */ placeholder?: string; /** Minimum selections. */ min_values?: number; /** Maximum selections. */ max_values?: number; /** Required state. */ required?: boolean; /** String-select options. */ options?: APISelectOption[]; }
/** Strict Discord entity-select payload. */
export interface APIEntitySelectComponent { /** Entity-select discriminator. */ type: typeof ComponentType.UserSelect | typeof ComponentType.RoleSelect | typeof ComponentType.MentionableSelect | typeof ComponentType.ChannelSelect; /** Custom identifier. */ custom_id?: string; /** Placeholder. */ placeholder?: string; /** Minimum selections. */ min_values?: number; /** Maximum selections. */ max_values?: number; /** Required state. */ required?: boolean; /** Disabled state. */ disabled?: boolean; }
/** Strict Discord text-input payload. */
export interface APITextInputComponent { /** Component discriminator. */ type: typeof ComponentType.TextInput; /** Text input style. */ style: typeof TextInputStyle.Short | typeof TextInputStyle.Paragraph; /** Custom identifier. */ custom_id?: string; /** Input label. */ label?: string; /** Placeholder. */ placeholder?: string; /** Minimum text length. */ min_length?: number; /** Maximum text length. */ max_length?: number; /** Required state. */ required?: boolean; /** Initial value. */ value?: string; }
/** Strict Discord modal payload. */
export interface APIModalComponent { /** Modal discriminator. */ type: 9; /** Modal identifier. */ custom_id?: string; /** Modal title. */ title?: string; /** Modal action-row children. */ components: Array<{ toJSON(): unknown }>; }
/** Child component payload accepted by an action row. */
export type APIActionRowChild = APIButtonComponent | APIStringSelectComponent | APIEntitySelectComponent | APITextInputComponent;
/** Strict Discord action-row payload. */
export interface APIActionRowComponent { /** Action-row discriminator. */ type: typeof ComponentType.ActionRow; /** Child component payloads. */ components: APIActionRowChild[]; }
/** Builds action-row component payloads. */
export class ActionRowBuilder<T extends { toJSON(): APIActionRowChild } = { toJSON(): APIActionRowChild }> {
    /** Components currently in the row. */ readonly #components: T[] = [];
    /** Adds components. @param components Components to add. @returns This builder. @throws {TypeError} When no components are supplied. @throws {RangeError} When more than five components would be present. */ public addComponents(...components: T[]): this { if (!components.length) throw new TypeError("At least one component is required."); if (this.#components.length + components.length > 5) throw new RangeError("An action row cannot contain more than 5 components."); this.#components.push(...components); return this; }
    /** Clears all components. @returns This builder. */ public clearComponents(): this { this.#components.length = 0; return this; }
    /** Serializes the action row. @returns Strict action-row payload. */ public toJSON(): APIActionRowComponent { return { type: ComponentType.ActionRow, components: this.#components.map(component => component.toJSON()) }; }
}
/** Builds string-select menus. */
export class StringSelectBuilder {
    /** Mutable string-select payload. */ readonly #data: APIStringSelectComponent = { type: ComponentType.StringSelect };
    /** Sets the custom identifier. @param value Identifier. @returns This builder. */ public setCustomId(value: string): this { validateText(value, 100, "Component custom ID"); this.#data.custom_id = value; return this; }
    /** Sets the placeholder. @param value Placeholder. @returns This builder. */ public setPlaceholder(value: string): this { validateText(value, 150, "Component placeholder"); this.#data.placeholder = value; return this; }
    /** Sets the minimum value count. @param value Count. @returns This builder. */ public setMinValues(value: number): this { validateCount(value, "min_values", 0); this.#data.min_values = value; return this; }
    /** Sets the maximum value count. @param value Count. @returns This builder. */ public setMaxValues(value: number): this { validateCount(value, "max_values", 1); this.#data.max_values = value; return this; }
    /** Sets required state. @param value Required state. @returns This builder. */ public setRequired(value = true): this { this.#data.required = value; return this; }
    /** Adds select options. @param options Options to add. @returns This builder. @throws {RangeError} When more than 25 options would be present. */ public addOptions(...options: APISelectOption[]): this { if (!options.length) throw new TypeError("At least one select option is required."); const current = this.#data.options ?? []; if (current.length + options.length > 25) throw new RangeError("A string select cannot contain more than 25 options."); for (const option of options) { validateText(option.label, 100, "Select option label"); validateText(option.value, 100, "Select option value"); if (option.description) validateText(option.description, 100, "Select option description"); } this.#data.options = [...current, ...options.map(option => ({ ...option }))]; return this; }
    /** Serializes the select. @returns Strict select payload. */ public toJSON(): APIStringSelectComponent { return structuredClone(this.#data); }
}
/** Builds button payloads. */
export class ButtonBuilder {
    /** Mutable button payload. */ readonly #data: APIButtonComponent = { type: ComponentType.Button, style: ButtonStyle.Secondary };
    /** Sets button style. @param style Style. @returns This builder. */ public setStyle(style: 1 | 2 | 3 | 4 | 5): this { if (![1, 2, 3, 4, 5].includes(style)) throw new RangeError("Invalid button style."); this.#data.style = style; return this; }
    /** Sets custom identifier. @param value Identifier. @returns This builder. */ public setCustomId(value: string): this { validateText(value, 100, "Button custom ID"); this.#data.custom_id = value; delete this.#data.url; if (this.#data.style === ButtonStyle.Link) this.#data.style = ButtonStyle.Secondary; return this; }
    /** Sets button label. @param value Label. @returns This builder. */ public setLabel(value: string): this { validateText(value, 80, "Button label"); this.#data.label = value; return this; }
    /** Sets button URL and link style. @param value URL. @returns This builder. */ public setURL(value: string): this { this.#data.url = validURL(value, "Button URL"); this.#data.style = ButtonStyle.Link; delete this.#data.custom_id; return this; }
    /** Sets button emoji. @param value Emoji. @returns This builder. */ public setEmoji(value: APIComponentEmoji): this { this.#data.emoji = { ...value }; return this; }
    /** Sets disabled state. @param value Disabled state. @returns This builder. */ public setDisabled(value = true): this { this.#data.disabled = value; return this; }
    /** Serializes the button. @returns Strict button payload. */ public toJSON(): APIButtonComponent { return structuredClone(this.#data); }
}
/** Builds entity select menus. */
export class EntitySelectBuilder {
    /** Mutable entity-select payload. */ readonly #data: APIEntitySelectComponent;
    /** Creates an entity select builder. @param type Entity select type. */ public constructor(type: APIEntitySelectComponent["type"]) { this.#data = { type }; }
    /** Sets custom identifier. @param value Identifier. @returns This builder. */ public setCustomId(value: string): this { validateText(value, 100, "Component custom ID"); this.#data.custom_id = value; return this; }
    /** Sets placeholder. @param value Placeholder. @returns This builder. */ public setPlaceholder(value: string): this { validateText(value, 150, "Component placeholder"); this.#data.placeholder = value; return this; }
    /** Sets minimum selections. @param value Count. @returns This builder. */ public setMinValues(value: number): this { validateCount(value, "min_values", 0); this.#data.min_values = value; return this; }
    /** Sets maximum selections. @param value Count. @returns This builder. */ public setMaxValues(value: number): this { validateCount(value, "max_values", 1); this.#data.max_values = value; return this; }
    /** Sets required state. @param value Required state. @returns This builder. */ public setRequired(value = true): this { this.#data.required = value; return this; }
    /** Sets disabled state. @param value Disabled state. @returns This builder. */ public setDisabled(value = true): this { this.#data.disabled = value; return this; }
    /** Serializes the entity select. @returns Strict entity-select payload. */ public toJSON(): APIEntitySelectComponent { return structuredClone(this.#data); }
}
/** Builds modal payloads. */
export class ModalBuilder {
    /** Mutable modal payload. */ readonly #data: APIModalComponent = { type: 9, components: [] };
    /** Sets modal custom identifier. @param value Identifier. @returns This builder. */ public setCustomId(value: string): this { validateText(value, 100, "Modal custom ID"); this.#data.custom_id = value; return this; }
    /** Sets modal title. @param value Title. @returns This builder. */ public setTitle(value: string): this { validateText(value, 45, "Modal title"); this.#data.title = value; return this; }
    /** Adds modal components. @param components Components. @returns This builder. @throws {RangeError} When more than five components are supplied. */ public addComponents(...components: Array<{ toJSON(): unknown }>): this { if (!components.length) throw new TypeError("At least one modal component is required."); if (this.#data.components.length + components.length > 5) throw new RangeError("A modal cannot contain more than 5 action rows."); this.#data.components.push(...components); return this; }
    /** Serializes the modal and recursively serializes nested builders. @returns Strict modal payload. */ public toJSON(): APIModalComponent { return { type: this.#data.type, ...(this.#data.custom_id ? { custom_id: this.#data.custom_id } : {}), ...(this.#data.title ? { title: this.#data.title } : {}), components: this.#data.components.map(component => component.toJSON()) }; }
}
/** Builds text-input payloads. */
export class TextInputBuilder {
    /** Mutable text-input payload. */ readonly #data: APITextInputComponent = { type: ComponentType.TextInput, style: TextInputStyle.Short };
    /** Sets custom identifier. @param value Identifier. @returns This builder. */ public setCustomId(value: string): this { validateText(value, 100, "Text input custom ID"); this.#data.custom_id = value; return this; }
    /** Sets text input style. @param style Style. @returns This builder. */ public setStyle(style: typeof TextInputStyle.Short | typeof TextInputStyle.Paragraph): this { this.#data.style = style; return this; }
    /** Sets input label. @param value Label. @returns This builder. */ public setLabel(value: string): this { validateText(value, 45, "Text input label"); this.#data.label = value; return this; }
    /** Sets placeholder. @param value Placeholder. @returns This builder. */ public setPlaceholder(value: string): this { validateText(value, 100, "Text input placeholder"); this.#data.placeholder = value; return this; }
    /** Sets minimum text length. @param value Length. @returns This builder. */ public setMinLength(value: number): this { validateLength(value, "min_length"); this.#data.min_length = value; return this; }
    /** Sets maximum text length. @param value Length. @returns This builder. */ public setMaxLength(value: number): this { validateLength(value, "max_length", 4000); this.#data.max_length = value; return this; }
    /** Sets required state. @param value Required state. @returns This builder. */ public setRequired(value = true): this { this.#data.required = value; return this; }
    /** Sets initial value. @param value Initial text. @returns This builder. */ public setValue(value: string): this { if (value.length > 4000) throw new RangeError("Text input value cannot exceed 4000 characters."); this.#data.value = value; return this; }
    /** Serializes the text input. @returns Strict text-input payload. */ public toJSON(): APITextInputComponent { return structuredClone(this.#data); }
}
/** Validates bounded Discord text. @param value Value. @param max Maximum length. @param name Field name. @returns Validated text. */ function validateText(value: string, max: number, name: string): string { if (typeof value !== "string" || !value.trim() || value.length > max) throw new RangeError(`${name} must contain 1-${max} characters.`); return value; }
/** Validates a component count. @param value Count. @param field Field name. @param minimum Minimum. @returns Nothing. */ function validateCount(value: number, field: string, minimum: number): void { if (!Number.isInteger(value) || value < minimum || value > 25) throw new RangeError(`${field} must be an integer between ${minimum} and 25.`); }
/** Validates a text length. @param value Length. @param field Field name. @param maximum Maximum. @returns Nothing. */ function validateLength(value: number, field: string, maximum = 1000): void { if (!Number.isInteger(value) || value < 0 || value > maximum) throw new RangeError(`${field} must be an integer between 0 and ${maximum}.`); }
/** Validates an absolute URL. @param value URL. @param field Field name. @returns Normalized URL. */ function validURL(value: string, field: string): string { try { return new URL(value).toString(); } catch (error) { throw new TypeError(`${field} must be valid.`, { cause: error }); } }