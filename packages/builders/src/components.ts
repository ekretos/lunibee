/** Component type constants exposed by Lunibee. */
export const ComponentType = {
    ActionRow: 1,
    Button: 2,
    StringSelect: 3,
    TextInput: 4,
    UserSelect: 5,
    RoleSelect: 6,
    MentionableSelect: 7,
    ChannelSelect: 8,
    Section: 9,
    TextDisplay: 10,
    Thumbnail: 11,
    MediaGallery: 12,
    File: 13,
    Separator: 14,
    ContentInventoryEntry: 16,
    Container: 17,
} as const;
export const ButtonStyle = {
    Primary: 1,
    Secondary: 2,
    Success: 3,
    Danger: 4,
    Link: 5,
} as const;
export const TextInputStyle = { Short: 1, Paragraph: 2 } as const;
export interface APIComponentEmoji {
    id?: string | null;
    name?: string | null;
    animated?: boolean;
}
export interface APIButtonComponent {
    type: typeof ComponentType.Button;
    style: 1 | 2 | 3 | 4 | 5;
    custom_id?: string;
    label?: string;
    emoji?: APIComponentEmoji;
    url?: string;
    disabled?: boolean;
}
export interface APISelectOption {
    label: string;
    value: string;
    description?: string;
    emoji?: APIComponentEmoji;
    default?: boolean;
}
export interface APIStringSelectComponent {
    type: typeof ComponentType.StringSelect;
    custom_id?: string;
    placeholder?: string;
    min_values?: number;
    max_values?: number;
    required?: boolean;
    disabled?: boolean;
    options?: APISelectOption[];
}
export interface APIEntitySelectComponent {
    type:
        | typeof ComponentType.UserSelect
        | typeof ComponentType.RoleSelect
        | typeof ComponentType.MentionableSelect
        | typeof ComponentType.ChannelSelect;
    custom_id?: string;
    placeholder?: string;
    min_values?: number;
    max_values?: number;
    required?: boolean;
    disabled?: boolean;
}
export interface APITextInputComponent {
    type: typeof ComponentType.TextInput;
    style: typeof TextInputStyle.Short | typeof TextInputStyle.Paragraph;
    custom_id?: string;
    label?: string;
    placeholder?: string;
    min_length?: number;
    max_length?: number;
    required?: boolean;
    value?: string;
}
export interface APIModalComponent {
    type: 9;
    custom_id?: string;
    title?: string;
    components: APIActionRowComponent[];
}
export type APIActionRowChild =
    | APIButtonComponent
    | APIStringSelectComponent
    | APIEntitySelectComponent
    | APITextInputComponent;
export interface APIActionRowComponent {
    type: typeof ComponentType.ActionRow;
    components: APIActionRowChild[];
}
export interface APISectionComponent {
    type: typeof ComponentType.Section;
    components?: APIComponent[]; // text displays
    accessory?: APIComponent; // buttons, thumbnails, etc.
}
export interface APITextDisplayComponent {
    type: typeof ComponentType.TextDisplay;
    content: string;
}
export interface APIMediaGalleryComponent {
    type: typeof ComponentType.MediaGallery;
    items: { media: { url: string; description?: string } }[];
}
export interface APIFileComponent {
    type: typeof ComponentType.File;
    file: { url: string };
    spoiler?: boolean;
}
export interface APISeparatorComponent {
    type: typeof ComponentType.Separator;
    spacing?: 1 | 2;
    divider?: boolean;
}
export interface APIThumbnailComponent {
    type: typeof ComponentType.Thumbnail;
    url: string;
    proxy_url?: string;
    width?: number;
    height?: number;
}
export interface APIContentInventoryEntryComponent {
    type: typeof ComponentType.ContentInventoryEntry;
    id: string;
}
export interface APIContainerComponent {
    type: typeof ComponentType.Container;
    components: APIComponent[];
    accent_color?: number;
}
export type APIComponent =
    | APIActionRowComponent
    | APIButtonComponent
    | APIStringSelectComponent
    | APIEntitySelectComponent
    | APITextInputComponent
    | APISectionComponent
    | APITextDisplayComponent
    | APIThumbnailComponent
    | APIMediaGalleryComponent
    | APIFileComponent
    | APISeparatorComponent
    | APIContentInventoryEntryComponent
    | APIContainerComponent;

export class ActionRowBuilder<
    T extends { toJSON(): APIActionRowChild } = { toJSON(): APIActionRowChild },
> {
    readonly #components: T[] = [];
    public addComponents(...components: T[]): this {
        if (!components.length)
            throw new TypeError("At least one component is required.");
        if (this.#components.length + components.length > 5)
            throw new RangeError(
                "An action row cannot contain more than 5 components.",
            );
        this.#components.push(...components);
        return this;
    }
    public clearComponents(): this {
        this.#components.length = 0;
        return this;
    }
    public toJSON(): APIActionRowComponent {
        return {
            type: ComponentType.ActionRow,
            components: this.#components.map((component) => component.toJSON()),
        };
    }
}
export class StringSelectBuilder {
    readonly #data: APIStringSelectComponent = {
        type: ComponentType.StringSelect,
    };
    public setCustomId(value: string): this {
        validateText(value, 100, "Component custom ID");
        this.#data.custom_id = value;
        return this;
    }
    public setPlaceholder(value: string): this {
        validateText(value, 150, "Component placeholder");
        this.#data.placeholder = value;
        return this;
    }
    public setMinValues(value: number): this {
        validateCount(value, "min_values", 0);
        this.#data.min_values = value;
        return this;
    }
    public setMaxValues(value: number): this {
        validateCount(value, "max_values", 1);
        this.#data.max_values = value;
        return this;
    }
    public setRequired(value = true): this {
        this.#data.required = value;
        return this;
    }
    public setDisabled(value = true): this {
        this.#data.disabled = value;
        return this;
    }
    public addOptions(...options: APISelectOption[]): this {
        if (!options.length)
            throw new TypeError("At least one select option is required.");
        const current = this.#data.options ?? [];
        if (current.length + options.length > 25)
            throw new RangeError(
                "A string select cannot contain more than 25 options.",
            );
        for (const option of options) {
            validateText(option.label, 100, "Select option label");
            validateText(option.value, 100, "Select option value");
            if (option.description)
                validateText(
                    option.description,
                    100,
                    "Select option description",
                );
        }
        this.#data.options = [
            ...current,
            ...options.map((option) => ({ ...option })),
        ];
        return this;
    }
    public toJSON(): APIStringSelectComponent {
        return structuredClone(this.#data);
    }
}
export class ButtonBuilder {
    readonly #data: APIButtonComponent = {
        type: ComponentType.Button,
        style: ButtonStyle.Secondary,
    };
    public setStyle(style: APIButtonComponent["style"]): this {
        this.#data.style = style;
        if (style === ButtonStyle.Link) delete this.#data.custom_id;
        return this;
    }
    public setCustomId(value: string): this {
        validateText(value, 100, "Button custom ID");
        if (this.#data.style === ButtonStyle.Link)
            throw new TypeError("Link buttons cannot use custom IDs.");
        this.#data.custom_id = value;
        return this;
    }
    public setLabel(value: string): this {
        validateText(value, 80, "Button label");
        this.#data.label = value;
        return this;
    }
    public setURL(value: string): this {
        validateText(value, 512, "Button URL");
        let url: URL;
        try {
            url = new URL(value);
        } catch (error) {
            throw new TypeError("Button URL must be a valid URL.", {
                cause: error,
            });
        }
        this.#data.style = ButtonStyle.Link;
        delete this.#data.custom_id;
        this.#data.url = url.toString();
        return this;
    }
    public setEmoji(emoji: APIComponentEmoji | string): this {
        this.#data.emoji =
            typeof emoji === "string" ? { name: emoji } : { ...emoji };
        return this;
    }
    public setDisabled(value = true): this {
        this.#data.disabled = value;
        return this;
    }
    public toJSON(): APIButtonComponent {
        return structuredClone(this.#data);
    }
}
export class EntitySelectBuilder {
    readonly #data: APIEntitySelectComponent;
    public constructor(
        type:
            | typeof ComponentType.UserSelect
            | typeof ComponentType.RoleSelect
            | typeof ComponentType.MentionableSelect
            | typeof ComponentType.ChannelSelect,
    ) {
        if (
            type !== ComponentType.UserSelect &&
            type !== ComponentType.RoleSelect &&
            type !== ComponentType.MentionableSelect &&
            type !== ComponentType.ChannelSelect
        )
            throw new TypeError("Invalid select component type.");
        this.#data = { type };
    }
    public setCustomId(value: string): this {
        validateText(value, 100, "Component custom ID");
        this.#data.custom_id = value;
        return this;
    }
    public setPlaceholder(value: string): this {
        validateText(value, 150, "Component placeholder");
        this.#data.placeholder = value;
        return this;
    }
    public setMinValues(value: number): this {
        validateCount(value, "min_values", 0);
        this.#data.min_values = value;
        return this;
    }
    public setMaxValues(value: number): this {
        validateCount(value, "max_values", 1);
        this.#data.max_values = value;
        return this;
    }
    public setRequired(value = true): this {
        this.#data.required = value;
        return this;
    }
    public setDisabled(value = true): this {
        this.#data.disabled = value;
        return this;
    }
    public setDefaultValues(
        ...values: { id: string; type: "user" | "role" | "channel" }[]
    ): this {
        (this.#data as any).default_values = values;
        return this;
    }
    public toJSON(): APIEntitySelectComponent {
        return structuredClone(this.#data);
    }
}
export class ModalBuilder {
    readonly #components: Array<{ toJSON(): APIActionRowComponent }> = [];
    #custom_id?: string;
    #title?: string;
    public setCustomId(value: string): this {
        validateText(value, 100, "Modal custom ID");
        this.#custom_id = value;
        return this;
    }
    public setTitle(value: string): this {
        validateText(value, 45, "Modal title");
        this.#title = value;
        return this;
    }
    public addComponents(
        ...components: Array<{ toJSON(): APIActionRowComponent }>
    ): this {
        if (!components.length)
            throw new TypeError("At least one modal component is required.");
        if (this.#components.length + components.length > 5)
            throw new RangeError(
                "A modal cannot contain more than 5 action rows.",
            );
        this.#components.push(...components);
        return this;
    }
    public toJSON(): APIModalComponent {
        return {
            type: 9,
            ...(this.#custom_id ? { custom_id: this.#custom_id } : {}),
            ...(this.#title ? { title: this.#title } : {}),
            components: this.#components.map((component) => component.toJSON()),
        };
    }
}
export class TextInputBuilder {
    readonly #data: APITextInputComponent = {
        type: ComponentType.TextInput,
        style: TextInputStyle.Short,
    };
    public setStyle(style: APITextInputComponent["style"]): this {
        this.#data.style = style;
        return this;
    }
    public setCustomId(value: string): this {
        validateText(value, 100, "Text input custom ID");
        this.#data.custom_id = value;
        return this;
    }
    public setLabel(value: string): this {
        validateText(value, 45, "Text input label");
        this.#data.label = value;
        return this;
    }
    public setPlaceholder(value: string): this {
        validateText(value, 100, "Text input placeholder");
        this.#data.placeholder = value;
        return this;
    }
    public setMinLength(value: number): this {
        validateLength(value, "min_length", 4000);
        this.#data.min_length = value;
        return this;
    }
    public setMaxLength(value: number): this {
        validateLength(value, "max_length", 4000);
        this.#data.max_length = value;
        return this;
    }
    public setRequired(value = true): this {
        this.#data.required = value;
        return this;
    }
    public setValue(value: string): this {
        validateText(value, 4000, "Text input value");
        this.#data.value = value;
        return this;
    }
    public toJSON(): APITextInputComponent {
        return structuredClone(this.#data);
    }
}

export class ContainerBuilder {
    readonly #components: { toJSON(): APIComponent }[] = [];
    #accentColor?: number;
    public addComponents(...components: { toJSON(): APIComponent }[]): this {
        if (!components.length)
            throw new TypeError("At least one component is required.");
        this.#components.push(...components);
        return this;
    }
    public setAccentColor(color: number): this {
        if (!Number.isInteger(color) || color < 0 || color > 0xffffff) {
            throw new RangeError(
                "Accent color must be an integer between 0 and 16777215 (0xFFFFFF).",
            );
        }
        this.#accentColor = color;
        return this;
    }
    public toJSON(): APIContainerComponent {
        return {
            type: ComponentType.Container,
            components: this.#components.map((c) => c.toJSON()),
            accent_color: this.#accentColor,
        };
    }
}

export class SectionBuilder {
    readonly #components: { toJSON(): APIComponent }[] = [];
    #accessory?: { toJSON(): APIComponent };
    public addComponents(...components: { toJSON(): APIComponent }[]): this {
        if (!components.length)
            throw new TypeError("At least one component is required.");
        this.#components.push(...components);
        return this;
    }
    public setAccessory(accessory: { toJSON(): APIComponent }): this {
        this.#accessory = accessory;
        return this;
    }
    public toJSON(): APISectionComponent {
        return {
            type: ComponentType.Section,
            components: this.#components.length
                ? this.#components.map((c) => c.toJSON())
                : undefined,
            accessory: this.#accessory?.toJSON(),
        };
    }
}

export class TextDisplayBuilder {
    #content = "";
    public setContent(content: string): this {
        validateText(content, 4000, "Text display content");
        this.#content = content;
        return this;
    }
    public toJSON(): APITextDisplayComponent {
        return {
            type: ComponentType.TextDisplay,
            content: this.#content,
        };
    }
}

export class MediaGalleryBuilder {
    readonly #items: { media: { url: string; description?: string } }[] = [];
    public addItems(...items: { url: string; description?: string }[]): this {
        if (!items.length) {
            throw new TypeError("At least one media gallery item is required.");
        }
        if (this.#items.length + items.length > 10) {
            throw new RangeError(
                "MediaGallery can only contain up to 10 items.",
            );
        }
        this.#items.push(...items.map((item) => ({ media: item })));
        return this;
    }
    public toJSON(): APIMediaGalleryComponent {
        return {
            type: ComponentType.MediaGallery,
            items: structuredClone(this.#items),
        };
    }
}

export class FileComponentBuilder {
    #url = "";
    #spoiler?: boolean;
    public setUrl(url: string): this {
        validateText(url, 2048, "File component URL");
        this.#url = url;
        return this;
    }
    public setSpoiler(spoiler = true): this {
        this.#spoiler = spoiler;
        return this;
    }
    public toJSON(): APIFileComponent {
        if (!this.#url) throw new Error("File component must have a URL.");
        const data: APIFileComponent = {
            type: ComponentType.File,
            file: { url: this.#url },
        };
        if (this.#spoiler !== undefined) data.spoiler = this.#spoiler;
        return data;
    }
}

export class SeparatorBuilder {
    #spacing?: 1 | 2;
    #divider?: boolean;
    public setSpacing(spacing: 1 | 2): this {
        this.#spacing = spacing;
        return this;
    }
    public setDivider(divider = true): this {
        this.#divider = divider;
        return this;
    }
    public toJSON(): APISeparatorComponent {
        const data: APISeparatorComponent = {
            type: ComponentType.Separator,
        };
        if (this.#spacing !== undefined) data.spacing = this.#spacing;
        if (this.#divider !== undefined) data.divider = this.#divider;
        return data;
    }
}

export class ThumbnailBuilder {
    #url = "";
    public setUrl(url: string): this {
        validateText(url, 2048, "Thumbnail URL");
        this.#url = url;
        return this;
    }
    public toJSON(): APIThumbnailComponent {
        return {
            type: ComponentType.Thumbnail,
            url: this.#url,
        };
    }
}

export class ContentInventoryEntryBuilder {
    #id = "";
    public setId(id: string): this {
        validateText(id, 100, "Content inventory entry ID");
        this.#id = id;
        return this;
    }
    public toJSON(): APIContentInventoryEntryComponent {
        return {
            type: ComponentType.ContentInventoryEntry,
            id: this.#id,
        };
    }
}

function validateText(value: string, max: number, field: string): void {
    if (typeof value !== "string")
        throw new TypeError(`${field} must be a string.`);
    if (!value.trim())
        throw new RangeError(`${field} must be a non-empty string.`);
    if (value.length > max)
        throw new RangeError(`${field} cannot exceed ${max} characters.`);
}
function validateCount(
    value: number,
    field: string,
    min: number,
    max = 25,
): void {
    if (!Number.isInteger(value) || value < min || value > max)
        throw new RangeError(
            `${field} must be an integer between ${min} and ${max}.`,
        );
}
function validateLength(value: number, field: string, max = 4000): void {
    if (!Number.isInteger(value) || value < 0 || value > max)
        throw new RangeError(
            `${field} must be an integer between 0 and ${max}.`,
        );
}
