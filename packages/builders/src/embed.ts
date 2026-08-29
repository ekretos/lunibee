/** Embed field data. */
export interface EmbedField {
    /** Field name. */
    name: string;
    /** Field value. */
    value: string;
    /** Whether the field is rendered inline. */
    inline?: boolean;
}

/** Builds rich embed payloads for Discord API requests. */
export class EmbedBuilder {
    readonly #data: Record<string, unknown> = {};

    /** Sets the embed title. */
    public setTitle(value: string): this { this.#data.title = validateLength(value, 256, "Embed title"); return this; }
    /** Sets the embed description. */
    public setDescription(value: string): this { this.#data.description = validateLength(value, 4096, "Embed description"); return this; }
    /** Sets the embed URL. */
    public setURL(value: string): this { this.#data.url = validateURL(value, "Embed URL"); return this; }
    /** Sets the embed color. */
    public setColor(value: number): this {
        if (!Number.isInteger(value) || value < 0 || value > 0xFFFFFF) throw new RangeError("Embed color must be an integer between 0 and 16777215.");
        this.#data.color = value;
        return this;
    }
    /** Sets the embed timestamp. */
    public setTimestamp(value = new Date()): this {
        const date = value instanceof Date ? value : new Date(value);
        if (Number.isNaN(date.getTime())) throw new RangeError("Embed timestamp must be a valid date.");
        this.#data.timestamp = date.toISOString();
        return this;
    }
    /** Sets the embed footer. */
    public setFooter(value: { text: string; icon_url?: string }): this {
        this.#data.footer = { ...value, text: validateLength(value.text, 2048, "Footer text") };
        if (value.icon_url) this.#data.footer = { ...this.#data.footer as object, icon_url: validateURL(value.icon_url, "Footer icon URL") };
        return this;
    }
    /** Sets the embed author. */
    public setAuthor(value: { name: string; url?: string; icon_url?: string }): this {
        this.#data.author = { ...value, name: validateLength(value.name, 256, "Author name") };
        if (value.url) this.#data.author = { ...this.#data.author as object, url: validateURL(value.url, "Author URL") };
        if (value.icon_url) this.#data.author = { ...this.#data.author as object, icon_url: validateURL(value.icon_url, "Author icon URL") };
        return this;
    }
    /** Sets the thumbnail URL. */
    public setThumbnail(url: string): this { this.#data.thumbnail = { url: validateURL(url, "Thumbnail URL") }; return this; }
    /** Sets the image URL. */
    public setImage(url: string): this { this.#data.image = { url: validateURL(url, "Image URL") }; return this; }
    /** Adds embed fields. */
    public addFields(...fields: EmbedField[]): this {
        const current = (this.#data.fields as EmbedField[] | undefined) ?? [];
        if (current.length + fields.length > 25) throw new RangeError("An embed cannot contain more than 25 fields.");
        for (const field of fields) {
            validateLength(field.name, 256, "Field name");
            validateLength(field.value, 1024, "Field value");
        }
        this.#data.fields = [...current, ...fields.map(field => ({ ...field }))];
        return this;
    }
    /** Removes all embed fields. */
    public clearFields(): this { delete this.#data.fields; return this; }
    /** Serializes the embed payload. */
    public toJSON(): Record<string, unknown> { return structuredClone(this.#data); }
}

function validateLength(value: string, max: number, field: string): string {
    if (typeof value !== "string" || value.length === 0 || value.length > max) throw new RangeError(`${field} must contain 1-${max} characters.`);
    return value;
}

function validateURL(value: string, field: string): string {
    try { return new URL(value).toString(); } catch { throw new TypeError(`${field} must be a valid URL.`); }
}
