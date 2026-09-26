import { Channel, User, type ResourceContext } from "./base.js";
import { TextChannel } from "./resources.js";
import type {
    APIChannel,
    APIForumTag,
    APIPartialEmoji,
    APIThreadMetadata,
} from "@lunibee/types";

// Discord.js-familiar channel subclasses. Every class extends Channel, so
// existing `instanceof Channel` checks and Channel methods keep working.

/** A guild announcement (news) channel. */
export class NewsChannel extends TextChannel {}

/** A direct-message or group DM channel. */
export class DMChannel extends Channel {
    /** Users in the conversation. */ public readonly recipients: User[];
    /** Owner of a group DM. */ public readonly ownerId: string | null;

    public constructor(data: APIChannel, context?: ResourceContext) {
        super(data, context);
        this.recipients = (data.recipients ?? []).map((u) => new User(u));
        this.ownerId = data.owner_id ?? null;
    }
}

/** A guild voice channel. */
export class VoiceChannel extends Channel {
    /** Bitrate in bits per second. */ public bitrate: number;
    /** User limit (0 = unlimited). */ public userLimit: number;
    /** Voice region override, or null for automatic. */ public rtcRegion:
        string | null;
    /** Camera video quality mode. */ public videoQualityMode: number;

    public constructor(data: APIChannel, context?: ResourceContext) {
        super(data, context);
        this.bitrate = data.bitrate ?? 64000;
        this.userLimit = data.user_limit ?? 0;
        this.rtcRegion = data.rtc_region ?? null;
        this.videoQualityMode = data.video_quality_mode ?? 1;
    }
}

/** A guild stage channel. */
export class StageChannel extends VoiceChannel {}

/** A guild category. */
export class CategoryChannel extends Channel {}

/** A thread (announcement, public or private). */
export class ThreadChannel extends Channel {
    /** User who created the thread. */ public readonly ownerId: string | null;
    /** Approximate message count. */ public messageCount: number;
    /** Approximate member count (stops counting at 50). */ public memberCount: number;
    /** Thread metadata. */ public metadata: APIThreadMetadata | null;

    public constructor(data: APIChannel, context?: ResourceContext) {
        super(data, context);
        this.ownerId = data.owner_id ?? null;
        this.messageCount = data.message_count ?? 0;
        this.memberCount = data.member_count ?? 0;
        this.metadata = data.thread_metadata ?? null;
    }

    /** Whether the thread is archived. */
    public get archived(): boolean {
        return this.metadata?.archived ?? false;
    }

    /** Whether the thread is locked. */
    public get locked(): boolean {
        return this.metadata?.locked ?? false;
    }

    /** Minutes of inactivity before the thread auto-archives. */
    public get autoArchiveDuration(): number | null {
        return this.metadata?.auto_archive_duration ?? null;
    }
}

/** A guild forum channel. */
export class ForumChannel extends Channel {
    /** Tags that threads can apply. */ public availableTags: APIForumTag[];
    /** Default reaction for new threads. */ public defaultReactionEmoji: APIPartialEmoji | null;
    /** Default slowmode for new threads. */ public defaultThreadRateLimitPerUser: number;
    /** Default auto-archive duration for new threads. */ public defaultAutoArchiveDuration:
        number | null;

    public constructor(data: APIChannel, context?: ResourceContext) {
        super(data, context);
        this.availableTags = data.available_tags ?? [];
        this.defaultReactionEmoji = data.default_reaction_emoji ?? null;
        this.defaultThreadRateLimitPerUser =
            data.default_thread_rate_limit_per_user ?? 0;
        this.defaultAutoArchiveDuration =
            data.default_auto_archive_duration ?? null;
    }
}

/** A guild media channel. */
export class MediaChannel extends ForumChannel {}

/**
 * Builds the most specific channel class for a payload's `type`, falling back
 * to {@link Channel} for types without a dedicated class.
 */
export function createChannel(
    data: APIChannel,
    context?: ResourceContext,
): Channel {
    switch (data.type) {
        case 0:
            return new TextChannel(data, context);
        case 1:
        case 3:
            return new DMChannel(data, context);
        case 2:
            return new VoiceChannel(data, context);
        case 4:
            return new CategoryChannel(data, context);
        case 5:
            return new NewsChannel(data, context);
        case 10:
        case 11:
        case 12:
            return new ThreadChannel(data, context);
        case 13:
            return new StageChannel(data, context);
        case 15:
            return new ForumChannel(data, context);
        case 16:
            return new MediaChannel(data, context);
        default:
            return new Channel(data, context);
    }
}
