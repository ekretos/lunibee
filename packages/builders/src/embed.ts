/** Embed field data. */
export interface EmbedField { name: string; value: string; inline?: boolean; }

/** Builds rich embed payloads for Discord API requests. */
export class EmbedBuilder {
    readonly #data: Record<string, unknown> = {};
    /** Sets the embed title. */ public setTitle(value: string): this { this.#data.title = validate(value, 256, "Embed title"); return this; }
    /** Sets the embed description. */ public setDescription(value: string): this { this.#data.description = validate(value, 4096, "Embed description"); return this; }
    /** Sets the embed URL. */ public setURL(value: string): this { this.#data.url = url(value, "Embed URL"); return this; }
    /** Sets the embed color. */ public setColor(value: number): this { if (!Number.isInteger(value) || value < 0 || value > 0xffffff) throw new RangeError("Embed color must be an integer between 0 and 16777215."); this.#data.color = value; return this; }
    /** Sets the embed timestamp. */ public setTimestamp(value = new Date()): this { const date = value instanceof Date ? value : new Date(value); if (Number.isNaN(date.getTime())) throw new RangeError("Embed timestamp must be a valid date."); this.#data.timestamp = date.toISOString(); return this; }
    /** Sets the embed footer. */ public setFooter(value: { text: string; icon_url?: string }): this { this.#data.footer = { text: validate(value.text, 2048, "Footer text"), ...(value.icon_url ? { icon_url: url(value.icon_url, "Footer icon URL") } : {}) }; return this; }
    /** Sets the embed author. */ public setAuthor(value: { name: string; url?: string; icon_url?: string }): this { this.#data.author = { name: validate(value.name, 256, "Author name"), ...(value.url ? { url: url(value.url, "Author URL") } : {}), ...(value.icon_url ? { icon_url: url(value.icon_url, "Author icon URL") } : {}) }; return this; }
    /** Sets the thumbnail URL. */ public setThumbnail(value: { url: string } | string): this { const valueURL = typeof value === "string" ? value : value.url; this.#data.thumbnail = { url: url(valueURL, "Thumbnail URL") }; return this; }
    /** Sets the image URL. */ public setImage(value: { url: string } | string): this { const valueURL = typeof value === "string" ? value : value.url; this.#data.image = { url: url(valueURL, "Image URL") }; return this; }
    /** Adds embed fields. */ public addFields(...fields: EmbedField[]): this { const current = (this.#data.fields as EmbedField[] | undefined) ?? []; if (current.length + fields.length > 25) throw new RangeError("An embed cannot contain more than 25 fields."); for (const field of fields) { validate(field.name, 256, "Field name"); validate(field.value, 1024, "Field value"); } this.#data.fields = [...current, ...fields.map(field => ({ ...field }))]; return this; }
    /** Replaces an existing field. */ public spliceFields(index: number, deleteCount: number, ...fields: EmbedField[]): this { const current = [...((this.#data.fields as EmbedField[] | undefined) ?? [])]; if (!Number.isInteger(index) || !Number.isInteger(deleteCount) || index < 0 || deleteCount < 0) throw new RangeError("Field index and delete count must be non-negative integers."); current.splice(index, deleteCount, ...fields); if (current.length > 25) throw new RangeError("An embed cannot contain more than 25 fields."); this.#data.fields = current; return this; }
    /** Removes all embed fields. */ public clearFields(): this { delete this.#data.fields; return this; }
    /** Removes the embed title. */ public clearTitle(): this { delete this.#data.title; return this; }
    /** Removes the embed description. */ public clearDescription(): this { delete this.#data.description; return this; }
    /** Serializes the embed payload. */ public toJSON(): Record<string, unknown> { return structuredClone(this.#data); }
}

function validate(value: string, max: number, field: string): string { if (typeof value !== "string" || value.length === 0 || value.length > max) throw new RangeError(`${field} must contain 1-${max} characters.`); return value; }
function url(value: string, field: string): string { try { return new URL(value).toString(); } catch (error) { throw new TypeError(`${field} must be a valid URL.`, { cause: error }); } }
