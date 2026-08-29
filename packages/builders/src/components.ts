/** Component type constants exposed by Lunibee. */
export const ComponentType = { ActionRow: 1, Button: 2, StringSelect: 3, TextInput: 4, UserSelect: 5, RoleSelect: 6, MentionableSelect: 7, ChannelSelect: 8 } as const;

/** Button appearance constants. */
export const ButtonStyle = { Primary: 1, Secondary: 2, Success: 3, Danger: 4, Link: 5 } as const;

/** Text input appearance constants. */
export const TextInputStyle = { Short: 1, Paragraph: 2 } as const;

/** Discord emoji payload used by message components. */
export interface APIComponentEmoji {
    /** Emoji identifier for custom emojis. */
    id?: string | null;
    /** Unicode emoji name or custom emoji name. */
    name?: string | null;
    /** Whether the custom emoji is animated. */
    animated?: boolean;
}

/** Strict Discord API button payload. */
export interface APIButtonComponent {
    /** Discord component type discriminator. */
    type: typeof ComponentType.Button;
    /** Button appearance style. */
    style: 1 | 2 | 3 | 4 | 5;
    /** Custom identifier for non-link buttons. */
    custom_id?: string;
    /** Visible button label. */
    label?: string;
    /** Optional button emoji. */
    emoji?: APIComponentEmoji;
    /** Absolute URL for link buttons. */
    url?: string;
    /** Whether the button is disabled. */
    disabled?: boolean;
}

/** Strict Discord API select option payload. */
export interface APISelectOption {
    /** Visible option label. */
    label: string;
    /** Submitted option value. */
    value: string;
    /** Optional option description. */
    description?: string;
    /** Optional option emoji. */
    emoji?: APIComponentEmoji;
    /** Whether this option is selected by default. */
    default?: boolean;
}

/** Strict Discord API string-select payload. */
export interface APIStringSelectComponent {
    /** Discord component type discriminator. */
    type: typeof ComponentType.StringSelect;
    /** Custom identifier for the select menu. */
    custom_id?: string;
    /** Placeholder displayed when no option is selected. */
    placeholder?: string;
    /** Minimum number of values that may be selected. */
    min_values?: number;
    /** Maximum number of values that may be selected. */
    max_values?: number;
    /** Whether the component is required. */
    required?: boolean;
    /** Available select options. */
    options?: APISelectOption[];
}

/** Strict Discord API entity-select payload. */
export interface APIEntitySelectComponent {
    /** Discord entity-select component type discriminator. */
    type: typeof ComponentType.UserSelect | typeof ComponentType.RoleSelect | typeof ComponentType.MentionableSelect | typeof ComponentType.ChannelSelect;
    /** Custom identifier for the select menu. */
    custom_id?: string;
    /** Placeholder displayed when no entity is selected. */
    placeholder?: string;
    /** Minimum number of values that may be selected. */
    min_values?: number;
    /** Maximum number of values that may be selected. */
    max_values?: number;
    /** Whether the component is required. */
    required?: boolean;
    /** Whether the component is disabled. */
    disabled?: boolean;
}

/** Strict Discord API text-input payload. */
export interface APITextInputComponent {
    /** Discord component type discriminator. */
    type: typeof ComponentType.TextInput;
    /** Text input appearance style. */
    style: typeof TextInputStyle.Short | typeof TextInputStyle.Paragraph;
    /** Custom identifier for the text input. */
    custom_id?: string;
    /** Label displayed above the input. */
    label?: string;
    /** Placeholder displayed when the input is empty. */
    placeholder?: string;
    /** Minimum accepted text length. */
    min_length?: number;
    /** Maximum accepted text length. */
    max_length?: number;
    /** Whether the input is required. */
    required?: boolean;
    /** Initial text value. */
    value?: string;
}

/** Strict Discord API modal payload. */
export interface APIModalComponent {
    /** Discord modal component type discriminator. */
    type: 9;
    /** Modal custom identifier. */
    custom_id?: string;
    /** Modal title. */
    title?: string;
    /** Modal action-row components. */
    components: Array<{ toJSON(): unknown }>;
}

/** Union of component payloads accepted inside an action row. */
export type APIActionRowChild = APIButtonComponent | APIStringSelectComponent | APIEntitySelectComponent | APITextInputComponent;

/** Strict Discord API action-row payload. */
export interface APIActionRowComponent {
    /** Discord action-row component type discriminator. */
    type: typeof ComponentType.ActionRow;
    /** Child components contained by the row. */
    components: APIActionRowChild[];
}

/** Builds an action-row component payload. */
export class ActionRowBuilder<T extends { toJSON(): APIActionRowChild } = { toJSON(): APIActionRowChild }> {
    /** Components currently contained by the action row. */
    readonly #components: T[] = [];

    /** Adds components to the row. @param components Components to add. @returns This builder. @throws {TypeError} If no components are supplied. @throws {RangeError} If Discord's five-component limit is exceeded. */
    public addComponents(...components: T[]): this {
        if (!components.length) throw new TypeError("At least one component is required.");
        if (this.#components.length + components.length > 5) throw new RangeError("An action row cannot contain more than 5 components.");
        this.#components.push(...components);
        return this;
    }

    /** Removes all row components. @returns This builder. */
    public clearComponents(): this {
        this.#components.length = 0;
        return this;
    }

    /** Serializes the row. @returns Strict action-row payload. */
    public toJSON(): APIActionRowComponent {
        return { type: ComponentType.ActionRow, components: this.#components.map(component => component.toJSON()) };
    }
}

/** Builds string-select menu payloads. */
export class StringSelectBuilder {
    /** Mutable string-select payload under construction. */
    readonly #data: APIStringSelectComponent = { type: ComponentType.StringSelect };

    /** Sets the custom identifier. @param value Identifier. @returns This builder. */
    public setCustomId(value: string): this { validateText(value, 100, "Component custom ID"); this.#data.custom_id = value; return this; }
    /** Sets placeholder text. @param value Placeholder. @returns This builder. */
    public setPlaceholder(value: string): this { validateText(value, 150, "Component placeholder"); this.#data.placeholder = value; return this; }
    /** Sets minimum selectable values. @param value Minimum count. @returns This builder. */
    public setMinValues(value: number): this { validateCount(value, "min_values", 0); this.#data.min_values = value; return this; }
    /** Sets maximum selectable values. @param value Maximum count. @returns This builder. */
    public setMaxValues(value: number): this { validateCount(value, "max_values", 1); this.#data.max_values = value; return this; }
    /** Sets whether a value is required. @param value Required state. @returns This builder. */
    public setRequired(value = true): this { this.#data.required = value; return this; }
    /** Adds string-select options. @param options Select options. @returns This builder. @throws {RangeError} If Discord's 25-option limit is exceeded. */
    public addOptions(...options: APISelectOption[]): this {
        if (!options.length) throw new TypeError("At least one select option is required.");
        const current = this.#data.options ?? [];
        if (current.length + options.length > 25) throw new RangeError("A string select cannot contain more than 25 options.");
        for (const option of options) {
            validateText(option.label, 100, "Select option label");
            validateText(option.value, 100, "Select option value");
            if (option.description) validateText(option.description, 100, "Select option description");
        }
        this.#data.options = [...current, ...options.map(option => ({ ...option }))];
        return this;
    }
    /** Serializes the select menu. @returns Strict string-select payload. */
    public toJSON(): APIStringSelectComponent { return structuredClone(this.#data); }
}

/** Builds button payloads with style-specific Discord constraints. */
export class ButtonBuilder {
    /** Mutable button payload under construction. */
    readonly #data: APIButtonComponent = { type: ComponentType.Button, style: ButtonStyle.Secondary };

    /** Sets the button style. @param style Discord button style. @returns This builder. @throws {RangeError} If style is invalid. */
    public setStyle(style: 1 | 2 | 3 | 4 | 5): this { if (![1, 2, 3, 4, 5].includes(style)) throw new RangeError("Invalid button style."); this.#data.style = style; return this; }
    /** Sets the custom identifier and makes the button non-link. @param value Custom ID. @returns This builder. */
    public setCustomId(value: string): this { validateText(value, 100, "Button custom ID"); this.#data.custom_id = value; delete this.#data.url; if (this.#data.style === ButtonStyle.Link) this.#data.style = ButtonStyle.Secondary; return this; }
    /** Sets the visible button label. @param value Label. @returns This builder. @throws {RangeError} If label exceeds 80 characters. */
    public setLabel(value: string): this { validateText(value, 80, "Button label"); this.#data.label = value; return this; }
    /** Sets a button URL and selects link style. @param value URL. @returns This builder. @throws {TypeError} If URL is invalid. */
    public setURL(value: string): this { this.#data.url = validURL(value, "Button URL"); this.#data.style = ButtonStyle.Link; delete this.#data.custom_id; return this; }
    /** Sets the button emoji. @param value Emoji payload. @returns This builder. */
    public setEmoji(value: APIComponentEmoji): this { this.#data.emoji = { ...value }; return this; }
    /** Disables or enables the button. @param value Disabled state. @returns This builder. */
    public setDisabled(value = true): this: this { this.#data.disabled = value; return this; }
    /** Serializes the button. @returns Strict button payload. */
    public toJSON(): APIButtonComponent { return structuredClone(this.#data); }
}

/** Builds entity select menus. */
export class EntitySelectBuilder {
    /** Mutable entity-select payload under construction. */
    readonly #data: APIEntitySelectComponent;

    /** Creates an entity select builder. @param type Entity select type. */
    public constructor(type: typeof ComponentType.UserSelect | typeof ComponentType.RoleSelect | typeof ComponentType.MentionableSelect | typeof ComponentType.ChannelSelect) { this.#data = { type }; }
    /** Sets the custom identifier. @param value Identifier. @returns This builder. */
    public setCustomId(value: string): this { validateText(value, 100, "Component custom ID"); this.#data.custom_id = value; return this; }
    /** Sets placeholder text. @param value Placeholder. @returns This builder. */
    public setPlaceholder(value: string): this { validateText(value, 150, "Component placeholder"); this.#data.placeholder = value; return this; }
    /** Sets minimum selections. @param value Minimum count. @returns This builder. */
    public setMinValues(value: number): this { validateCount(value, "min_values", 0); this.#data.min_values = value; return this; }
    /** Sets maximum selections. @param value Maximum count. @returns This builder. */
    public setMaxValues(value: number): this { validateCount(value, "max_values", 1); this.#data.max_values = value; return this; }
    /** Sets the required flag. @param value Required state. @returns This builder. */
    public setRequired(value = true): this { this.#data.required = value; return this; }
    /** Sets the disabled flag. @param value Disabled state. @returns This builder. */
    public setDisabled(value = true): this { this.#data.disabled = value; return this; }
    /** Serializes the entity select. @returns Strict entity-select payload. */
    public toJSON(): APIEntitySelectComponent { return structuredClone(this.#data); }
}

/** Builds modal payloads. */
export class ModalBuilder {
    /** Mutable modal payload under construction. */
    readonly #data: APIModalComponent = { type: 9, components: [] };

    /** Sets the modal custom identifier. @param value Identifier. @returns This builder. */
    public setCustomId(value: string): this { validateText(value, 100, "Modal custom ID"); this.#data.custom_id = value; return this; }
    /** Sets the modal title. @param value Title. @returns This builder. */
    public setTitle(value: string): this { validateText(value, 45, "Modal title"); this.#data.title = value; return this; }
    /** Adds modal components. @param components Components to add. @returns This builder. @throws {RangeError} If five-row limit is exceeded. */
    public addComponents(...components: Array<{ toJSON(): unknown }>): this { if (!components.length) throw new TypeError("At least one modal component is required."); if (this.#data.components.length + components.length > 5) throw new RangeError("A modal cannot contain more than 5 action rows."); this.#data.components.push(...components); return this; }
    /** Serializes the modal. @returns Strict modal payload. */
    public toJSON(): APIModalComponent { return structuredClone(this.#data); }
}

/** Builds text-input payloads for modal action rows. */
export class TextInputBuilder {
    /** Mutable text-input payload under construction. */
    readonly #data: APITextInputComponent = { type: ComponentType.TextInput, style: TextInputStyle.Short };

    /** Sets the custom identifier. @param value Identifier. @returns This builder. */
    public setCustomId(value: string): this { validateText(value, 100, "Text input custom ID"); this.#data.custom_id = value; return this; }
    /** Sets the text input style. @param style Input style. @returns This builder. */
    public setStyle(style: typeof TextInputStyle.Short | typeof TextInputStyle.Paragraph): this { if (style !== 1 && style !== 2) throw new RangeError("Invalid text input style."); this.#data.style = style; return this; }
    /** Sets the text input label. @param value Label. @returns This builder. */
    public setLabel(value: string): this { validateText(value, 45, "Text input label"); this.#data.label = value; return this; }
    /** Sets placeholder text. @param value Placeholder. @returns This builder. */
    public setPlaceholder(value: string): this { validateText(value, 100, "Text input placeholder"); this.#data.placeholder = value; return this; }
    /** Sets the minimum text length. @param value Minimum length. @returns This builder. */
    public setMinLength(value: number): this { validateLength(value, "min_length"); this.#data.min_length = value; return this; }
    /** Sets the maximum text length. @param value Maximum length. @returns This builder. */
    public setMaxLength(value: number): this { validateLength(value, "max_length", 4000); this.#data.max_length = value; return this; }
    /** Sets whether the input is required. @param value Required state. @returns This builder. */
    public setRequired(value = true): this { this.#data.required = value; return this; }
    /** Sets the initial value. @param value Initial text. @returns This builder. */
    public setValue(value: string): this { if (value.length > 4000) throw new RangeError("Text input value cannot exceed 4000 characters."); this.#data.value = value; return this; }
    /** Serializes the text input. @returns Strict text-input payload. */
    public toJSON(): APITextInputComponent { return structuredClone(this.#data); }
}

/** Validates bounded Discord text. @param value Value. @param max Maximum length. @param name Field name. @returns Validated text. @throws {RangeError} If invalid. */
function validateText(value: string, max: number, name: string): string { if (typeof value !== "string" || !value.trim() || value.length > max) throw new RangeError(`${name} must contain 1-${max} characters.`); return value; }
/** Validates a component count. @param value Count. @param field Field name. @param minimum Minimum. @returns Nothing. @throws {RangeError} If invalid. */
function validateCount(value: number, field: string, minimum: number): void { if (!Number.isInteger(value) || value < minimum || value > 25) throw new RangeError(`${field} must be an integer between ${minimum} and 25.`); }
/** Validates a text length. @param value Length. @param field Field name. @param maximum Maximum. @returns Nothing. @throws {RangeError} If invalid. */
function validateLength(value: number, field: string, maximum = 1000): void { if (!Number.isInteger(value) || value < 0 || value > maximum) throw new RangeError(`${field} must be an integer between 0 and ${maximum}.`); }
/** Validates an absolute URL. @param value URL. @param field Field name. @returns Normalized URL. @throws {TypeError} If invalid. */
function validURL(value: string, field: string): string { try { return new URL(value).toString(); } catch (error) { throw new TypeError(`${field} must be valid.`, { cause: error }); } }
