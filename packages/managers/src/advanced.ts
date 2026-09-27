import { Manager } from "./base.js";
import { Routes, type REST } from "@lunibee/rest";
import type { APISticker, UserData } from "@lunibee/types";

/** Appends encoded query parameters, skipping undefined values. */
function withQuery(
    path: string,
    query: Record<string, string | number | boolean | undefined>,
): string {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(query))
        if (value !== undefined) params.set(key, String(value));
    const suffix = params.toString();
    return suffix ? `${path}?${suffix}` : path;
}

// ─── Stickers ────────────────────────────────────────────────────────────────

/** Fields for {@link GuildStickerManager.create}. */
export interface GuildStickerCreateOptions {
    name: string;
    description: string;
    /** Autocomplete/suggestion tags (e.g. an emoji name). */
    tags: string;
    /** PNG, APNG, GIF or Lottie JSON file, max 512 KiB. */
    file: Blob;
    reason?: string;
}

/** Manages a guild's custom stickers, cached by sticker ID. */
export class GuildStickerManager extends Manager<string, APISticker> {
    readonly #rest: REST;
    public readonly guildId: string;

    public constructor(rest: REST, guildId: string) {
        super();
        this.#rest = rest;
        this.guildId = guildId;
    }

    #store(sticker: APISticker): APISticker {
        this.set(sticker.id, sticker);
        return sticker;
    }

    /** Fetches every sticker in the guild, replacing the cache. */
    public async fetchAll(): Promise<APISticker[]> {
        const stickers = await this.#rest.get<APISticker[]>(
            Routes.guildSticker(this.guildId),
        );
        this.clear();
        return stickers.map((sticker) => this.#store(sticker));
    }

    /** Fetches one sticker. */
    public async fetch(stickerId: string): Promise<APISticker> {
        return this.#store(
            await this.#rest.get<APISticker>(
                Routes.guildSticker(this.guildId, stickerId),
            ),
        );
    }

    /** Uploads a sticker (multipart form, as Discord requires). */
    public async create(
        options: GuildStickerCreateOptions,
    ): Promise<APISticker> {
        const form = new FormData();
        form.set("name", options.name);
        form.set("description", options.description);
        form.set("tags", options.tags);
        form.set("file", options.file);
        return this.#store(
            await this.#rest.post<APISticker>(
                Routes.guildSticker(this.guildId),
                form,
                { reason: options.reason },
            ),
        );
    }

    /** Edits a sticker's name, description or tags. */
    public async edit(
        stickerId: string,
        options: {
            name?: string;
            description?: string | null;
            tags?: string;
            reason?: string;
        },
    ): Promise<APISticker> {
        const { reason, ...body } = options;
        return this.#store(
            await this.#rest.patch<APISticker>(
                Routes.guildSticker(this.guildId, stickerId),
                body,
                { reason },
            ),
        );
    }

    /** Deletes a sticker. */
    public async remove(stickerId: string, reason?: string): Promise<void> {
        await this.#rest.delete(Routes.guildSticker(this.guildId, stickerId), {
            reason,
        });
        this.delete(stickerId);
    }

    /** Replaces the cache with the full list from a `GUILD_STICKERS_UPDATE` event. */
    public sync(stickers: readonly APISticker[]): void {
        this.clear();
        for (const sticker of stickers) this.#store(sticker);
    }
}

// ─── Soundboard ──────────────────────────────────────────────────────────────

/** Raw Discord soundboard sound. */
export interface APISoundboardSound {
    sound_id: string;
    name: string;
    volume: number;
    emoji_id: string | null;
    emoji_name: string | null;
    guild_id?: string;
    available: boolean;
    user?: UserData;
}

/** Fields for {@link GuildSoundboardManager.create}. */
export interface SoundboardSoundCreateOptions {
    name: string;
    /** Data URI of an MP3 or OGG file (max 512 KiB, 5.2 s). */
    sound: string;
    /** 0 to 1; defaults to 1. */
    volume?: number;
    emojiId?: string;
    emojiName?: string;
    reason?: string;
}

/** Manages a guild's soundboard sounds, cached by sound ID. */
export class GuildSoundboardManager extends Manager<
    string,
    APISoundboardSound
> {
    readonly #rest: REST;
    public readonly guildId: string;

    public constructor(rest: REST, guildId: string) {
        super();
        this.#rest = rest;
        this.guildId = guildId;
    }

    #store(sound: APISoundboardSound): APISoundboardSound {
        this.set(sound.sound_id, sound);
        return sound;
    }

    /** Fetches every soundboard sound in the guild, replacing the cache. */
    public async fetchAll(): Promise<APISoundboardSound[]> {
        const { items } = await this.#rest.get<{
            items: APISoundboardSound[];
        }>(Routes.guildSoundboardSound(this.guildId));
        this.clear();
        return items.map((sound) => this.#store(sound));
    }

    /** Fetches one sound. */
    public async fetch(soundId: string): Promise<APISoundboardSound> {
        return this.#store(
            await this.#rest.get<APISoundboardSound>(
                Routes.guildSoundboardSound(this.guildId, soundId),
            ),
        );
    }

    /** Creates a sound. */
    public async create(
        options: SoundboardSoundCreateOptions,
    ): Promise<APISoundboardSound> {
        if (
            options.volume !== undefined &&
            (options.volume < 0 || options.volume > 1)
        )
            throw new RangeError("Soundboard volume must be between 0 and 1.");
        return this.#store(
            await this.#rest.post<APISoundboardSound>(
                Routes.guildSoundboardSound(this.guildId),
                {
                    name: options.name,
                    sound: options.sound,
                    volume: options.volume,
                    emoji_id: options.emojiId,
                    emoji_name: options.emojiName,
                },
                { reason: options.reason },
            ),
        );
    }

    /** Edits a sound's name, volume or emoji. */
    public async edit(
        soundId: string,
        options: {
            name?: string;
            volume?: number | null;
            emojiId?: string | null;
            emojiName?: string | null;
            reason?: string;
        },
    ): Promise<APISoundboardSound> {
        return this.#store(
            await this.#rest.patch<APISoundboardSound>(
                Routes.guildSoundboardSound(this.guildId, soundId),
                {
                    name: options.name,
                    volume: options.volume,
                    emoji_id: options.emojiId,
                    emoji_name: options.emojiName,
                },
                { reason: options.reason },
            ),
        );
    }

    /** Deletes a sound. */
    public async remove(soundId: string, reason?: string): Promise<void> {
        await this.#rest.delete(
            Routes.guildSoundboardSound(this.guildId, soundId),
            { reason },
        );
        this.delete(soundId);
    }
}

// ─── Monetization ────────────────────────────────────────────────────────────

/** Raw Discord SKU. */
export interface APISKU {
    id: string;
    type: number;
    application_id: string;
    name: string;
    slug: string;
    flags: number;
}

/** Raw Discord entitlement. */
export interface APIEntitlement {
    id: string;
    sku_id: string;
    application_id: string;
    user_id?: string;
    guild_id?: string;
    type: number;
    deleted: boolean;
    starts_at?: string | null;
    ends_at?: string | null;
    consumed?: boolean;
}

/** Raw Discord subscription. */
export interface APISubscription {
    id: string;
    user_id: string;
    sku_ids: string[];
    entitlement_ids: string[];
    current_period_start: string;
    current_period_end: string;
    status: number;
    canceled_at: string | null;
    country?: string;
}

/** Filters for {@link MonetizationManager.fetchEntitlements}. */
export interface EntitlementQuery {
    userId?: string;
    skuIds?: string[];
    guildId?: string;
    before?: string;
    after?: string;
    /** 1-100, default 100. */
    limit?: number;
    excludeEnded?: boolean;
    excludeDeleted?: boolean;
}

/**
 * SKUs, entitlements and subscriptions for one application. Entitlements are
 * cached by ID and kept current by the client's `ENTITLEMENT_*` events.
 */
export class MonetizationManager extends Manager<string, APIEntitlement> {
    readonly #rest: REST;
    public readonly applicationId: string;

    public constructor(rest: REST, applicationId: string) {
        super();
        this.#rest = rest;
        this.applicationId = applicationId;
    }

    /** Fetches the application's SKUs. */
    public fetchSkus(): Promise<APISKU[]> {
        return this.#rest.get<APISKU[]>(
            Routes.applicationSkus(this.applicationId),
        );
    }

    /** Fetches entitlements matching the filters and caches them. */
    public async fetchEntitlements(
        query: EntitlementQuery = {},
    ): Promise<APIEntitlement[]> {
        if (
            query.limit !== undefined &&
            (!Number.isInteger(query.limit) ||
                query.limit < 1 ||
                query.limit > 100)
        )
            throw new RangeError("Entitlement limit must be 1-100.");
        const entitlements = await this.#rest.get<APIEntitlement[]>(
            withQuery(Routes.applicationEntitlement(this.applicationId), {
                user_id: query.userId,
                sku_ids: query.skuIds?.join(","),
                guild_id: query.guildId,
                before: query.before,
                after: query.after,
                limit: query.limit,
                exclude_ended: query.excludeEnded,
                exclude_deleted: query.excludeDeleted,
            }),
        );
        for (const entitlement of entitlements)
            this.set(entitlement.id, entitlement);
        return entitlements;
    }

    /** Fetches one entitlement. */
    public async fetch(entitlementId: string): Promise<APIEntitlement> {
        const entitlement = await this.#rest.get<APIEntitlement>(
            Routes.applicationEntitlement(this.applicationId, entitlementId),
        );
        this.set(entitlement.id, entitlement);
        return entitlement;
    }

    /** Marks a one-time-purchase entitlement as consumed. */
    public async consume(entitlementId: string): Promise<void> {
        await this.#rest.post(
            Routes.consumeEntitlement(this.applicationId, entitlementId),
        );
        const cached = this.get(entitlementId);
        if (cached) cached.consumed = true;
    }

    /** Creates a test entitlement for a user or guild (owner type 1 = guild, 2 = user). */
    public async createTestEntitlement(options: {
        skuId: string;
        ownerId: string;
        ownerType: 1 | 2;
    }): Promise<APIEntitlement> {
        const entitlement = await this.#rest.post<APIEntitlement>(
            Routes.applicationEntitlement(this.applicationId),
            {
                sku_id: options.skuId,
                owner_id: options.ownerId,
                owner_type: options.ownerType,
            },
        );
        this.set(entitlement.id, entitlement);
        return entitlement;
    }

    /** Deletes a test entitlement. */
    public async deleteTestEntitlement(entitlementId: string): Promise<void> {
        await this.#rest.delete(
            Routes.applicationEntitlement(this.applicationId, entitlementId),
        );
        this.delete(entitlementId);
    }

    /** Fetches a SKU's subscriptions for a user, or one subscription. */
    public fetchSubscriptions(
        skuId: string,
        query: {
            userId?: string;
            before?: string;
            after?: string;
            limit?: number;
        } = {},
    ): Promise<APISubscription[]> {
        return this.#rest.get<APISubscription[]>(
            withQuery(Routes.skuSubscription(skuId), {
                user_id: query.userId,
                before: query.before,
                after: query.after,
                limit: query.limit,
            }),
        );
    }

    /** Fetches one subscription. */
    public fetchSubscription(
        skuId: string,
        subscriptionId: string,
    ): Promise<APISubscription> {
        return this.#rest.get<APISubscription>(
            Routes.skuSubscription(skuId, subscriptionId),
        );
    }
}
