/** Discord embed field data. */
export interface EmbedField { /** Field name. */ name: string; /** Field value. */ value: string; /** Whether the field is inline. */ inline?: boolean; }

/** Builds Discord embeds with a fluent API. */
export class EmbedBuilder {
    readonly #data: Record<string, unknown> = {};
    /** Sets the title. */ public setTitle(value: string): this { this.#data.title = value; return this; }
    /** Sets the description. */ public setDescription(value: string): this { this.#data.description = value; return this; }
    /** Sets the URL. */ public setURL(value: string): this { this.#data.url = value; return this; }
    /** Sets the color. */ public setColor(value: number): this { this.#data.color = value; return this; }
    /** Sets the timestamp. */ public setTimestamp(value = new Date()): this { this.#data.timestamp = value.toISOString(); return this; }
    /** Sets the footer. */ public setFooter(value: { text: string; icon_url?: string }): this { this.#data.footer = value; return this; }
    /** Sets the author. */ public setAuthor(value: { name: string; url?: string; icon_url?: string }): this { this.#data.author = value; return this; }
    /** Sets the thumbnail. */ public setThumbnail(url: string): this { this.#data.thumbnail = { url }; return this; }
    /** Sets the image. */ public setImage(url: string): this { this.#data.image = { url }; return this; }
    /** Adds fields. */ public addFields(...fields: EmbedField[]): this { this.#data.fields = [...((this.#data.fields as EmbedField[] | undefined) ?? []), ...fields]; return this; }
    /** Removes all fields. */ public clearFields(): this { delete this.#data.fields; return this; }
    /** Returns the Discord API representation. */ public toJSON(): Record<string, unknown> { return structuredClone(this.#data); }
}
