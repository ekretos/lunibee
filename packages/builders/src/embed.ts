/** Discord API embed field payload. */
export interface EmbedField {
  /** Field name. */ name: string;
  /** Field value. */ value: string;
  /** Whether the field is displayed inline. */ inline?: boolean;
}
/** Discord API embed footer payload. */
export interface EmbedFooter {
  /** Footer text. */ text: string;
  /** Footer icon URL. */ icon_url?: string;
}
/** Discord API embed author payload. */
export interface EmbedAuthor {
  /** Author display name. */ name: string;
  /** Author URL. */ url?: string;
  /** Author icon URL. */ icon_url?: string;
}
/** Strict Discord API embed payload. */
export interface APIEmbed {
  /** Embed title. */ title?: string;
  /** Embed description. */ description?: string;
  /** Embed URL. */ url?: string;
  /** Embed color. */ color?: number;
  /** ISO-8601 timestamp. */ timestamp?: string;
  /** Embed footer. */ footer?: EmbedFooter;
  /** Embed author. */ author?: EmbedAuthor;
  /** Thumbnail payload. */ thumbnail?: { /** Thumbnail URL. */ url: string };
  /** Image payload. */ image?: { /** Image URL. */ url: string };
  /** Embed fields. */ fields?: EmbedField[];
}

/** Builds compile-time-safe rich embed payloads for Discord API requests. */
export class EmbedBuilder {
  readonly #data: APIEmbed = {};
  /** Sets the embed title. @param value Title text. @returns This builder. @throws {RangeError} If title exceeds Discord's limit. */ public setTitle(
    value: string,
  ): this {
    this.#data.title = validate(value, 256, "Embed title");
    return this;
  }
  /** Sets the embed description. @param value Description text. @returns This builder. @throws {RangeError} If description exceeds Discord's limit. */ public setDescription(
    value: string,
  ): this {
    this.#data.description = validate(value, 4096, "Embed description");
    return this;
  }
  /** Sets the embed URL. @param value Absolute URL. @returns This builder. @throws {TypeError} If URL is invalid. */ public setURL(
    value: string,
  ): this {
    this.#data.url = url(value, "Embed URL");
    return this;
  }
  /** Sets the embed color. @param value RGB integer. @returns This builder. @throws {RangeError} If color is outside 24-bit RGB range. */ public setColor(
    value: number,
  ): this {
    if (!Number.isInteger(value) || value < 0 || value > 0xffffff)
      throw new RangeError(
        "Embed color must be an integer between 0 and 16777215.",
      );
    this.#data.color = value;
    return this;
  }
  /** Sets the embed timestamp. @param value Date value. @returns This builder. @throws {RangeError} If date is invalid. */ public setTimestamp(
    value = new Date(),
  ): this {
    const date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime()))
      throw new RangeError("Embed timestamp must be a valid date.");
    this.#data.timestamp = date.toISOString();
    return this;
  }
  /** Sets the embed footer. @param value Footer payload. @returns This builder. @throws {RangeError} If footer text exceeds Discord's limit. */ public setFooter(
    value: EmbedFooter,
  ): this {
    this.#data.footer = {
      text: validate(value.text, 2048, "Footer text"),
      ...(value.icon_url
        ? { icon_url: url(value.icon_url, "Footer icon URL") }
        : {}),
    };
    return this;
  }
  /** Sets the embed author. @param value Author payload. @returns This builder. @throws {RangeError} If author name exceeds Discord's limit. */ public setAuthor(
    value: EmbedAuthor,
  ): this {
    this.#data.author = {
      name: validate(value.name, 256, "Author name"),
      ...(value.url ? { url: url(value.url, "Author URL") } : {}),
      ...(value.icon_url
        ? { icon_url: url(value.icon_url, "Author icon URL") }
        : {}),
    };
    return this;
  }
  /** Sets the thumbnail URL. @param value Thumbnail URL or payload. @returns This builder. @throws {TypeError} If URL is invalid. */ public setThumbnail(
    value: { url: string } | string,
  ): this {
    const valueURL = typeof value === "string" ? value : value.url;
    this.#data.thumbnail = { url: url(valueURL, "Thumbnail URL") };
    return this;
  }
  /** Sets the image URL. @param value Image URL or payload. @returns This builder. @throws {TypeError} If URL is invalid. */ public setImage(
    value: { url: string } | string,
  ): this {
    const valueURL = typeof value === "string" ? value : value.url;
    this.#data.image = { url: url(valueURL, "Image URL") };
    return this;
  }
  /** Adds embed fields. @param fields Field payloads. @returns This builder. @throws {RangeError} If the 25-field limit is exceeded. */ public addFields(
    ...fields: EmbedField[]
  ): this {
    const current = this.#data.fields ?? [];
    if (current.length + fields.length > 25)
      throw new RangeError("An embed cannot contain more than 25 fields.");
    for (const field of fields) {
      validate(field.name, 256, "Field name");
      validate(field.value, 1024, "Field value");
    }
    this.#data.fields = [...current, ...fields.map((field) => ({ ...field }))];
    return this;
  }
  /** Replaces fields starting at an index. @param index Start index. @param deleteCount Number of fields to remove. @param fields Replacement fields. @returns This builder. @throws {RangeError} If arguments are invalid or the 25-field limit is exceeded. */ public spliceFields(
    index: number,
    deleteCount: number,
    ...fields: EmbedField[]
  ): this {
    const current = [...(this.#data.fields ?? [])];
    if (
      !Number.isInteger(index) ||
      !Number.isInteger(deleteCount) ||
      index < 0 ||
      deleteCount < 0
    )
      throw new RangeError(
        "Field index and delete count must be non-negative integers.",
      );
    current.splice(index, deleteCount, ...fields);
    if (current.length > 25)
      throw new RangeError("An embed cannot contain more than 25 fields.");
    this.#data.fields = current;
    return this;
  }
  /** Removes all embed fields. @returns This builder. */ public clearFields(): this {
    delete this.#data.fields;
    return this;
  }
  /** Removes the embed title. @returns This builder. */ public clearTitle(): this {
    delete this.#data.title;
    return this;
  }
  /** Removes the embed description. @returns This builder. */ public clearDescription(): this {
    delete this.#data.description;
    return this;
  }
  /** Returns a deep-cloned Discord API payload. @returns Strict embed payload. */ public toJSON(): APIEmbed {
    return structuredClone(this.#data);
  }
}
/** Validates a bounded Discord string field. @param value Field value. @param max Maximum length. @param field Human-readable field name. @returns Validated value. @throws {RangeError} If length is invalid. */
function validate(value: string, max: number, field: string): string {
  if (typeof value !== "string" || value.length === 0 || value.length > max)
    throw new RangeError(`${field} must contain 1-${max} characters.`);
  return value;
}
/** Validates and normalizes an absolute URL. @param value URL value. @param field Human-readable field name. @returns Normalized URL. @throws {TypeError} If URL is invalid. */
function url(value: string, field: string): string {
  try {
    return new URL(value).toString();
  } catch (error) {
    throw new TypeError(`${field} must be a valid URL.`, { cause: error });
  }
}
