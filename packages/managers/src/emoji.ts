import { Manager } from "./base.js";
import { Emoji } from "@lunibee/structures";
import { Routes, type REST } from "@lunibee/rest";

export interface EmojiCreateOptions extends Record<string, unknown> {
    name: string;
    image: string;
    roles?: string[];
}

export interface EmojiEditOptions extends Record<string, unknown> {
    name?: string;
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

    /** Upserts an emoji into the manager cache. */
    public upsert(data: ConstructorParameters<typeof Emoji>[0]): Emoji {
        const id = data.id ?? "unicode";
        if (id === "unicode") return new Emoji(data);
        
        const existing = this.get(id);
        const emoji = new Emoji(data);
        if (existing) {
            Object.assign(existing, emoji);
            return existing;
        }
        this.set(id, emoji);
        return emoji;
    }
}
