import { REST, Routes } from "@lunibee/rest";
import {
    Channel,
    createChannel,
    type ResourceContext,
} from "@lunibee/structures";
import type {
    APIChannel,
    APIGuildMember,
    APIThreadMember,
    MessageCreateOptions,
} from "@lunibee/types";
import { toAttachments } from "./message.js";

type ChannelData = ConstructorParameters<typeof Channel>[0];

/** Options shared by every way of starting a thread. */
export interface ThreadCreateOptions {
    name: string;
    /** Minutes of inactivity before it archives: 60, 1440, 4320 or 10080. */
    autoArchiveDuration?: 60 | 1440 | 4320 | 10080;
    /** Seconds a member must wait between messages (0-21600). */
    rateLimitPerUser?: number;
    reason?: string;
}

/** What a thread member lookup may ask Discord to include. */
export interface ThreadMemberQuery {
    /** Include each member's guild member object. */
    withMember?: boolean;
}

/** Which archived threads to list. */
export type ArchivedThreadScope = "public" | "private" | "joined-private";

/** One page of archived threads. */
export interface ArchivedThreads {
    threads: Channel[];
    members: APIThreadMember[];
    hasMore: boolean;
}

/** Manages thread resources created from a parent channel. */
export class ThreadManager {
    readonly #rest: REST;
    readonly #context: ResourceContext;
    readonly #channelId: string;
    /** Creates a thread manager. @param rest REST transport. @param context Structure resource context. @param channelId Parent channel identifier. @throws {TypeError} If channelId is empty. */
    public constructor(
        rest: REST,
        context: ResourceContext,
        channelId: string,
    ) {
        if (!channelId) throw new TypeError("Channel ID is required.");
        this.#rest = rest;
        this.#context = context;
        this.#channelId = channelId;
    }
    /** Creates a thread from a message. @param messageId Message identifier. @param options Thread creation options. @returns Created thread channel. @throws {Error} If REST rejects the request. */
    public async createFromMessage(
        messageId: string,
        options: {
            name: string;
            autoArchiveDuration?: 60 | 1440 | 4320 | 10080;
            rateLimitPerUser?: number;
        },
    ): Promise<Channel> {
        const data = await this.#rest.post<
            ConstructorParameters<typeof Channel>[0]
        >(Routes.messageThread(this.#channelId, messageId), {
            name: options.name,
            auto_archive_duration: options.autoArchiveDuration,
            rate_limit_per_user: options.rateLimitPerUser,
        });
        return createChannel(data, this.#context);
    }

    /**
     * Starts a thread that is not attached to a message: a private thread
     * (`type: 12`, the default) or a public one (`type: 11`) in a text or
     * announcement channel.
     */
    public async create(
        options: ThreadCreateOptions & {
            /** 11 public, 12 private (default), 10 announcement. */
            type?: 10 | 11 | 12;
            /** Whether non-moderators can add other members to a private thread. */
            invitable?: boolean;
        },
    ): Promise<Channel> {
        const data = await this.#rest.post<ChannelData>(
            Routes.channelThreads(this.#channelId),
            {
                name: options.name,
                type: options.type ?? 12,
                auto_archive_duration: options.autoArchiveDuration,
                rate_limit_per_user: options.rateLimitPerUser,
                invitable: options.invitable,
            },
            { reason: options.reason },
        );
        return createChannel(data, this.#context);
    }

    /**
     * Posts to a forum or media channel: one request creates the thread and its
     * first message. `message` takes everything `send()` does, files included.
     */
    public async createForumPost(
        options: ThreadCreateOptions & {
            message: MessageCreateOptions;
            /** IDs of the channel's tags to apply. */
            appliedTags?: string[];
        },
    ): Promise<Channel> {
        const { message, appliedTags, reason, ...thread } = options;
        const { files, ...content } = message;
        const data = await this.#rest.post<ChannelData>(
            Routes.channelThreads(this.#channelId),
            {
                name: thread.name,
                auto_archive_duration: thread.autoArchiveDuration,
                rate_limit_per_user: thread.rateLimitPerUser,
                applied_tags: appliedTags,
                message: content,
            },
            { files: files?.length ? toAttachments(files) : undefined, reason },
        );
        return createChannel(data, this.#context);
    }

    /**
     * Lists archived threads of this channel, newest first. `joined-private`
     * is the private archived threads the bot is a member of.
     */
    public async fetchArchived(
        scope: ArchivedThreadScope,
        options: { before?: string; limit?: number } = {},
    ): Promise<ArchivedThreads> {
        const route =
            scope === "public"
                ? Routes.channelPublicArchivedThreads(this.#channelId)
                : scope === "private"
                  ? Routes.channelPrivateArchivedThreads(this.#channelId)
                  : Routes.channelJoinedPrivateArchivedThreads(this.#channelId);
        const params = new URLSearchParams();
        if (options.before) params.set("before", options.before);
        if (options.limit !== undefined)
            params.set(
                "limit",
                String(Math.min(100, Math.max(1, options.limit))),
            );
        const query = params.toString();
        const page = await this.#rest.get<{
            threads: APIChannel[];
            members: APIThreadMember[];
            has_more: boolean;
        }>(`${route}${query ? `?${query}` : ""}`);
        return {
            threads: page.threads.map((thread) =>
                createChannel(thread as ChannelData, this.#context),
            ),
            members: page.members,
            hasMore: page.has_more,
        };
    }

    /** Joins a thread as the bot. */
    public async join(threadId: string): Promise<void> {
        await this.#rest.put(Routes.threadMember(threadId, "@me"));
    }

    /** Leaves a thread as the bot. */
    public async leave(threadId: string): Promise<void> {
        await this.#rest.delete(Routes.threadMember(threadId, "@me"));
    }

    /** Adds a member to a thread. */
    public async addMember(threadId: string, userId: string): Promise<void> {
        await this.#rest.put(Routes.threadMember(threadId, userId));
    }

    /** Removes a member from a thread. */
    public async removeMember(threadId: string, userId: string): Promise<void> {
        await this.#rest.delete(Routes.threadMember(threadId, userId));
    }

    /** Fetches one thread member; rejects with a 404 when they have not joined. */
    public async fetchMember(
        threadId: string,
        userId: string,
        query: ThreadMemberQuery = {},
    ): Promise<APIThreadMember & { member?: APIGuildMember }> {
        const suffix = query.withMember ? "?with_member=true" : "";
        return this.#rest.get(
            `${Routes.threadMember(threadId, userId)}${suffix}`,
        );
    }

    /** Lists thread members (needs the Guild Members intent), one page at a time (`limit` 1-100). */
    public async fetchMembers(
        threadId: string,
        options: ThreadMemberQuery & { after?: string; limit?: number } = {},
    ): Promise<APIThreadMember[]> {
        const params = new URLSearchParams();
        if (options.withMember) params.set("with_member", "true");
        if (options.after) params.set("after", options.after);
        if (options.limit !== undefined)
            params.set(
                "limit",
                String(Math.min(100, Math.max(1, options.limit))),
            );
        const query = params.toString();
        return this.#rest.get(
            `${Routes.threadMembers(threadId)}${query ? `?${query}` : ""}`,
        );
    }
}
