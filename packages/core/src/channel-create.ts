import { ChannelKinds, type APIOverwrite } from "@lunibee/types";
import type { ChannelCreateOptions } from "@lunibee/managers";

/** What every kind of channel takes when it is created. */
interface CreateBase {
    /** 1-100 characters. */
    name: string;
    /** The category to put it in. */
    parent?: string;
    position?: number;
    permissionOverwrites?: APIOverwrite[];
    /** Audit-log reason. */
    reason?: string;
}

/** Seconds of inactivity before a thread in the channel archives itself. */
type AutoArchive = 60 | 1440 | 4320 | 10080;

/** A text or announcement channel. */
export interface CreateTextChannel extends CreateBase {
    kind: "text" | "announcement";
    topic?: string;
    nsfw?: boolean;
    /** Seconds a member must wait between messages (0-21600). */
    slowmode?: number;
    autoArchive?: AutoArchive;
}

/** A voice or stage channel. */
export interface CreateVoiceChannel extends CreateBase {
    kind: "voice" | "stage";
    /** Bits per second. */
    bitrate?: number;
    /** 0-99; 0 is unlimited. */
    userLimit?: number;
    /** Voice region id, or `null` for automatic. */
    region?: string | null;
    videoQuality?: "auto" | "720p";
    nsfw?: boolean;
}

/** A category. */
export interface CreateCategoryChannel extends CreateBase {
    kind: "category";
}

/** A forum tag: a unicode emoji, or a custom emoji's id. */
export interface ForumTagInput {
    name: string;
    emoji?: string;
    /** Only moderators can apply it. */
    moderated?: boolean;
}

/** A forum or media channel. */
export interface CreateForumChannel extends CreateBase {
    kind: "forum" | "media";
    /** The guidelines shown above the posts. */
    topic?: string;
    nsfw?: boolean;
    slowmode?: number;
    /** Slowmode for posts' threads, in seconds. */
    threadSlowmode?: number;
    autoArchive?: AutoArchive;
    tags?: ForumTagInput[];
    /** The reaction added to new posts: a unicode emoji, or a custom emoji's id. */
    defaultReaction?: string;
    sortOrder?: "latest-activity" | "creation-date";
    /** Forum only. */
    layout?: "list" | "gallery";
}

/** The options for `guild.createChannel()`; `kind` decides which others apply. */
export type CreateChannelOptions =
    | CreateTextChannel
    | CreateVoiceChannel
    | CreateCategoryChannel
    | CreateForumChannel;

const CREATABLE = [
    "text",
    "announcement",
    "voice",
    "stage",
    "category",
    "forum",
    "media",
] as const satisfies readonly CreateChannelOptions["kind"][];

function emoji(value: string): {
    emoji_id: string | null;
    emoji_name: string | null;
} {
    return /^\d+$/.test(value)
        ? { emoji_id: value, emoji_name: null }
        : { emoji_id: null, emoji_name: value };
}

/**
 * Turns `createChannel()` options into the request Discord expects.
 * @throws {RangeError} For a name or number Discord would refuse.
 */
export function channelCreatePayload(
    options: CreateChannelOptions,
): ChannelCreateOptions {
    if (!(CREATABLE as readonly string[]).includes(options.kind))
        throw new TypeError(
            `Cannot create a ${String(options.kind)} channel here. Use one of: ${CREATABLE.join(", ")}.`,
        );
    if (options.name.length < 1 || options.name.length > 100)
        throw new RangeError("A channel name must be 1-100 characters.");
    const body: ChannelCreateOptions = {
        name: options.name,
        type: ChannelKinds[options.kind][0],
        parent_id: options.parent,
        position: options.position,
        permission_overwrites: options.permissionOverwrites,
        reason: options.reason,
    };
    switch (options.kind) {
        case "text":
        case "announcement":
        case "forum":
        case "media": {
            if (
                options.slowmode !== undefined &&
                (!Number.isInteger(options.slowmode) ||
                    options.slowmode < 0 ||
                    options.slowmode > 21_600)
            )
                throw new RangeError("slowmode must be 0-21600 seconds.");
            body.topic = options.topic;
            body.nsfw = options.nsfw;
            body.rate_limit_per_user = options.slowmode;
            body.default_auto_archive_duration = options.autoArchive;
            if (options.kind === "forum" || options.kind === "media") {
                body.default_thread_rate_limit_per_user =
                    options.threadSlowmode;
                body.available_tags = options.tags?.map((tag) => ({
                    name: tag.name,
                    moderated: tag.moderated ?? false,
                    ...(tag.emoji ? emoji(tag.emoji) : {}),
                }));
                if (options.defaultReaction)
                    body.default_reaction_emoji = emoji(
                        options.defaultReaction,
                    );
                if (options.sortOrder)
                    body.default_sort_order =
                        options.sortOrder === "latest-activity" ? 0 : 1;
                if (options.layout)
                    body.default_forum_layout =
                        options.layout === "list" ? 1 : 2;
            }
            break;
        }
        case "voice":
        case "stage":
            if (
                options.userLimit !== undefined &&
                (!Number.isInteger(options.userLimit) ||
                    options.userLimit < 0 ||
                    options.userLimit > 99)
            )
                throw new RangeError("userLimit must be 0-99.");
            body.bitrate = options.bitrate;
            body.user_limit = options.userLimit;
            body.rtc_region = options.region;
            body.nsfw = options.nsfw;
            if (options.videoQuality)
                body.video_quality_mode =
                    options.videoQuality === "auto" ? 1 : 2;
            break;
        case "category":
            break;
    }
    return body;
}
