import {
    StickerFormatEnum,
    type APISticker,
    type APIStickerItem,
    type UserData,
} from "@lunibee/types";
import { BaseStructure } from "./base.js";

/** Where a sticker's image lives on Discord's CDN, by format. Lottie stickers are JSON, GIFs come from the media host. */
export function stickerURL(
    id: string,
    format: number,
    options: { size?: number } = {},
): string {
    const size = options.size === undefined ? "" : `?size=${options.size}`;
    if (format === StickerFormatEnum.Lottie)
        return `https://cdn.discordapp.com/stickers/${id}.json`;
    if (format === StickerFormatEnum.GIF)
        return `https://media.discordapp.net/stickers/${id}.gif${size}`;
    return `https://cdn.discordapp.com/stickers/${id}.png${size}`;
}

/** A sticker: a guild's own, one from a Nitro pack, or a standard one. */
export class Sticker extends BaseStructure {
    public readonly name: string;
    public readonly description: string | null;
    /** Comma-separated autocomplete tags. */
    public readonly tags: string;
    /** 1 standard (from a pack), 2 guild. */
    public readonly type: number;
    /** 1 PNG, 2 APNG, 3 Lottie, 4 GIF. */
    public readonly formatType: number;
    /** Whether the sticker can be used (guild stickers become unavailable when the boost level drops). */
    public readonly available: boolean;
    public readonly guildId: string | null;
    public readonly packId: string | null;
    public readonly sortValue: number | null;
    /** Who uploaded it, for guild stickers. */
    public readonly user: UserData | null;

    public constructor(data: APISticker) {
        super(data.id);
        this.name = data.name;
        this.description = data.description ?? null;
        this.tags = data.tags ?? "";
        this.type = data.type ?? 2;
        this.formatType = data.format_type;
        this.available = data.available ?? true;
        this.guildId = data.guild_id ?? null;
        this.packId = data.pack_id ?? null;
        this.sortValue = data.sort_value ?? null;
        this.user = data.user ?? null;
    }

    /** Whether the sticker moves: APNG, Lottie or GIF. */
    public get animated(): boolean {
        return this.formatType !== StickerFormatEnum.PNG;
    }

    /** The sticker's image URL (a `.json` file for Lottie). */
    public url(options: { size?: number } = {}): string {
        return stickerURL(this.id, this.formatType, options);
    }

    /** The sticker as a message carries it. */
    public toItem(): APIStickerItem {
        return { id: this.id, name: this.name, format_type: this.formatType };
    }
}
