import type {
    APIEmbed,
    APIEmbedAuthor,
    APIEmbedField,
    APIEmbedFooter,
    APIEmbedMedia,
} from "@lunibee/types";

/**
 * A rich Embed structure that wraps a Discord API embed object.
 * Provides typed accessors and a fluent builder interface.
 */
export class Embed {
    #data: APIEmbed;

    /** Creates an Embed from raw Discord API data, or starts a blank embed. */
    public constructor(data: APIEmbed = {}) {
        this.#data = { ...data };
        if (this.#data.fields) this.#data.fields = [...this.#data.fields];
    }

    // ── Read accessors ───────────────────────────────────────────────────────

    /** Embed title. */
    public get title(): string | undefined {
        return this.#data.title;
    }
    /** Embed description. */
    public get description(): string | undefined {
        return this.#data.description;
    }
    /** Embed URL. */
    public get url(): string | undefined {
        return this.#data.url;
    }
    /** Embed color as an integer. */
    public get color(): number | undefined {
        return this.#data.color;
    }
    /** Embed timestamp ISO 8601 string. */
    public get timestamp(): string | undefined {
        return this.#data.timestamp;
    }
    /** Embed timestamp as a Date object, or undefined. */
    public get createdAt(): Date | undefined {
        return this.#data.timestamp
            ? new Date(this.#data.timestamp)
            : undefined;
    }
    /** Embed footer. */
    public get footer(): APIEmbedFooter | undefined {
        return this.#data.footer;
    }
    /** Embed image. */
    public get image(): APIEmbedMedia | undefined {
        return this.#data.image;
    }
    /** Embed thumbnail. */
    public get thumbnail(): APIEmbedMedia | undefined {
        return this.#data.thumbnail;
    }
    /** Embed video. */
    public get video(): APIEmbedMedia | undefined {
        return this.#data.video;
    }
    /** Embed author. */
    public get author(): APIEmbedAuthor | undefined {
        return this.#data.author;
    }
    /** Embed fields (read-only copy). */
    public get fields(): readonly APIEmbedField[] {
        return this.#data.fields ?? [];
    }

    // ── Fluent builder methods ────────────────────────────────────────────────

    /** Sets the embed title. @param title Embed title text (max 256 chars). @throws {TypeError} If title exceeds 256 characters. */
    public setTitle(title: string): this {
        if (title.length > 256)
            throw new TypeError("Embed title must not exceed 256 characters.");
        this.#data.title = title;
        return this;
    }

    /** Sets the embed description. @param description Embed description (max 4096 chars). @throws {TypeError} If description exceeds 4096 characters. */
    public setDescription(description: string): this {
        if (description.length > 4096)
            throw new TypeError(
                "Embed description must not exceed 4096 characters.",
            );
        this.#data.description = description;
        return this;
    }

    /** Sets the embed URL. @param url A valid URL string. */
    public setURL(url: string): this {
        this.#data.url = url;
        return this;
    }

    /** Sets the embed color. Accepts a hex number (0xff0000), decimal integer, or hex string ("#ff0000"). @param color Color value. */
    public setColor(color: number | string): this {
        if (typeof color === "string") {
            const hex = color.replace(/^#/, "");
            this.#data.color = parseInt(hex, 16);
        } else {
            this.#data.color = color;
        }
        return this;
    }

    /** Sets the embed timestamp. Accepts a Date, ISO string, or number (ms since epoch). Defaults to now. */
    public setTimestamp(timestamp: Date | string | number = Date.now()): this {
        this.#data.timestamp = new Date(timestamp).toISOString();
        return this;
    }

    /** Sets the embed footer. @param text Footer text (max 2048 chars). @param iconURL Optional footer icon URL. */
    public setFooter(text: string, iconURL?: string): this {
        if (text.length > 2048)
            throw new TypeError(
                "Embed footer text must not exceed 2048 characters.",
            );
        this.#data.footer = iconURL ? { text, icon_url: iconURL } : { text };
        return this;
    }

    /** Sets the embed image. @param url Image URL. */
    public setImage(url: string): this {
        this.#data.image = { url };
        return this;
    }

    /** Sets the embed thumbnail. @param url Thumbnail URL. */
    public setThumbnail(url: string): this {
        this.#data.thumbnail = { url };
        return this;
    }

    /** Sets the embed author. @param name Author name (max 256 chars). @param options Optional URL and icon URL. */
    public setAuthor(
        name: string,
        options: { url?: string; iconURL?: string } = {},
    ): this {
        if (name.length > 256)
            throw new TypeError(
                "Embed author name must not exceed 256 characters.",
            );
        this.#data.author = {
            name,
            url: options.url,
            icon_url: options.iconURL,
        };
        return this;
    }

    /** Adds one or more fields to the embed. @param fields Fields to add (max 25 total). @throws {TypeError} If adding exceeds 25 fields. */
    public addFields(...fields: APIEmbedField[]): this {
        const existing = this.#data.fields ?? [];
        if (existing.length + fields.length > 25)
            throw new TypeError("Embeds cannot have more than 25 fields.");
        for (const field of fields) {
            if (field.name.length > 256)
                throw new TypeError(
                    "Embed field name must not exceed 256 characters.",
                );
            if (field.value.length > 1024)
                throw new TypeError(
                    "Embed field value must not exceed 1024 characters.",
                );
        }
        this.#data.fields = [...existing, ...fields];
        return this;
    }

    /** Removes all fields from the embed. */
    public clearFields(): this {
        this.#data.fields = [];
        return this;
    }

    /** Splices the fields array, replacing, inserting, or deleting fields. @param index Start index. @param deleteCount Number of fields to remove. @param fields Replacement fields. */
    public spliceFields(
        index: number,
        deleteCount: number,
        ...fields: APIEmbedField[]
    ): this {
        const next = [...(this.#data.fields ?? [])];
        next.splice(index, deleteCount, ...fields);
        if (next.length > 25)
            throw new TypeError("Embeds cannot have more than 25 fields.");
        for (const field of fields) {
            if (field.name.length > 256)
                throw new TypeError(
                    "Embed field name must not exceed 256 characters.",
                );
            if (field.value.length > 1024)
                throw new TypeError(
                    "Embed field value must not exceed 1024 characters.",
                );
        }
        this.#data.fields = next;
        return this;
    }

    // ── Serialization ─────────────────────────────────────────────────────────

    /** Returns the raw Discord API embed payload. */
    public toJSON(): APIEmbed {
        const json = { ...this.#data };
        if (json.fields) json.fields = [...json.fields];
        return json;
    }

    /** Creates an Embed from an existing raw API embed object. */
    public static from(data: APIEmbed): Embed {
        return new Embed(data);
    }
}
