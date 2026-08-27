/** Represents an embed field. */
export interface EmbedField { /** Field name. */ name: string; /** Field value. */ value: string; /** Display inline. */ inline?: boolean; }

/** Builds Discord embed payloads. */
export class EmbedBuilder {
    readonly #data: Record<string, unknown> = {};

    /** Sets the embed title. */
    public setTitle(title: string): this { this.#data.title = title; return this; }
    /** Sets the embed description. */
    public setDescription(description: string): this { this.#data.description = description; return this; }
    /** Sets the embed URL. */
    public setURL(url: string): this { this.#data.url = url; return this; }
    /** Sets the embed color. */
    public setColor(color: number): this { this.#data.color = color; return this; }
    /** Sets the embed timestamp. */
    public setTimestamp(timestamp = new Date()): this { this.#data.timestamp = timestamp.toISOString(); return this; }
    /** Sets the embed footer. */
    public setFooter(footer: { text: string; icon_url?: string }): this { this.#data.footer = footer; return this; }
    /** Sets the embed thumbnail. */
    public setThumbnail(url: string): this { this.#data.thumbnail = { url }; return this; }
    /** Sets the embed image. */
    public setImage(url: string): this { this.#data.image = { url }; return this; }
    /** Adds a field to the embed. */
    public addFields(...fields: EmbedField[]): this { this.#data.fields = [...((this.#data.fields as EmbedField[] | undefined) ?? []), ...fields]; return this; }
    /** Returns the Discord API representation. */
    public toJSON(): Record<string, unknown> { return structuredClone(this.#data); }
}

/** Builds Discord button components. */
export class ButtonBuilder {
    readonly #data: Record<string, unknown> = { type: 2 };
    /** Sets the button custom ID. */
    public setCustomId(customId: string): this { this.#data.custom_id = customId; return this; }
    /** Sets the button label. */
    public setLabel(label: string): this { this.#data.label = label; return this; }
    /** Sets the button style. */
    public setStyle(style: number): this { this.#data.style = style; return this; }
    /** Sets the button URL. */
    public setURL(url: string): this { this.#data.url = url; return this; }
    /** Sets whether the button is disabled. */
    public setDisabled(disabled = true): this { this.#data.disabled = disabled; return this; }
    /** Returns the Discord API representation. */
    public toJSON(): Record<string, unknown> { return structuredClone(this.#data); }
}
