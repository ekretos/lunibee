import { Manager } from "./base.js";
import { Emoji } from "@lunibee/structures";
import { Routes, type REST } from "@lunibee/rest";

/** Strict payload for creating a custom guild emoji. */
export interface EmojiCreateOptions {
    /** Emoji name (1-32 chars, alphanumeric + underscores). */
    name: string;
    /** Base64-encoded 128x128 image data URI. */
    image: string;
    /** Role IDs allowed to use the emoji. */
    roles?: string[];
}

/** Strict payload for editing a custom guild emoji. */
export interface EmojiEditOptions {
    /** New emoji name. */
    name?: string;
    /** Role IDs allowed to use the emoji. */
    roles?: string[];
}

/** Manages custom emojis for a guild. */
export class EmojiManager extends Manager<string, Emoji> {
    readonly #rest: REST;
    readonly #guildId: string;

    public constructor(rest: REST, guildId: string) {
        super();
        this.#rest = rest;
        this.#guildId = guildId;
    }

    /** Fetches an emoji by ID from Discord. */
    public async fetch(emojiId: string): Promise<Emoji> {
        return this.upsert(
            await this.#rest.get<ConstructorParameters<typeof Emoji>[0]>(
                Routes.guildEmoji(this.#guildId, emojiId)
            )
        );
    }

    /** Fetches all emojis for this guild. */
    public async fetchAll(): Promise<Emoji[]> {
        const data = await this.#rest.get<ConstructorParameters<typeof Emoji>[0][]>(
            Routes.guildEmoji(this.#guildId)
        );
        return data.map((item) => this.upsert(item));
    }

    /** Creates a new custom emoji. */
    public async create(options: EmojiCreateOptions): Promise<Emoji> {
        return this.upsert(
            await this.#rest.post<ConstructorParameters<typeof Emoji>[0]>(
                Routes.guildEmoji(this.#guildId),
                options
            )
        );
    }

    /** Edits an existing custom emoji. */
    public async edit(emojiId: string, options: EmojiEditOptions): Promise<Emoji> {
        return this.upsert(
            await this.#rest.patch<ConstructorParameters<typeof Emoji>[0]>(
                Routes.guildEmoji(this.#guildId, emojiId),
                options
            )
        );
    }

    /** Deletes a custom emoji. */
    public async deleteEmoji(emojiId: string): Promise<void> {
        await this.#rest.delete(Routes.guildEmoji(this.#guildId, emojiId));
        this.delete(emojiId);
    }

    /** Upserts an emoji into the manager cache. Custom emojis are keyed by their
     * snowflake ID; unicode emojis (no ID) are keyed by `unicode:${name}` so repeated
     * upserts reuse the same cached instance instead of allocating a new one each call. */
    public upsert(data: ConstructorParameters<typeof Emoji>[0]): Emoji {
        const key =
            data.id != null ? data.id : `unicode:${data.name ?? ""}`;
        const existing = this.get(key);
        const emoji = new Emoji(data);
        if (existing) {
            Object.assign(existing, emoji);
            return existing;
        }
        this.set(key, emoji);
        return emoji;
    }
}
