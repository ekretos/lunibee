import { REST, type RESTFileAttachment } from "./index.js";
import { Routes } from "./routes.js";
import type {
    AllowedMentions,
    APIEmbed,
    APIMessage,
    APIMessageComponent,
} from "@lunibee/types";

/** Where a `WebhookClient` sends: a Discord webhook `url`, or its `id` and `token`. */
export interface WebhookClientOptions {
    id?: string;
    token?: string;
    url?: string;
}

/** A webhook message for `send()` and `editMessage()`; camelCase aliases (`avatarURL`, `threadId`, `allowedMentions`) are accepted beside the wire names. */
export interface WebhookMessageOptions {
    content?: string;
    username?: string;
    avatar_url?: string;
    tts?: boolean;
    embeds?: (APIEmbed | { toJSON(): APIEmbed })[];
    components?: (APIMessageComponent | { toJSON(): APIMessageComponent })[];
    /** Uploaded as multipart form data. */
    files?: RESTFileAttachment[];
    flags?: number;
    thread_id?: string;
    /** Discord.js-familiar alias of `avatar_url`. */
    avatarURL?: string;
    /** Discord.js-familiar alias of `thread_id`. */
    threadId?: string;
    /** Discord.js-familiar alias of `allowed_mentions`. */
    allowedMentions?: AllowedMentions;
    allowed_mentions?: AllowedMentions;
}

/** Standalone client for sending Discord webhooks. */
export class WebhookClient {
    /** Webhook ID. */
    public readonly id: string;
    /** Webhook security token. */
    public readonly token: string;
    readonly #rest: REST;

    public constructor(
        options: WebhookClientOptions,
        restOptions?: { timeout?: number; retries?: number },
    ) {
        if (options.url) {
            // Anchored: the URL must be Discord's own webhook URL, not merely contain one.
            const match = options.url.match(
                /^https:\/\/(?:(?:ptb|canary)\.)?discord(?:app)?\.com\/api(?:\/v\d+)?\/webhooks\/(\d{1,20})\/([A-Za-z0-9_-]+)\/?(?:[?#].*)?$/,
            );
            if (!match) throw new Error("Invalid Discord webhook URL format.");
            this.id = match[1]!;
            this.token = match[2]!;
        } else if (options.id && options.token) {
            this.id = options.id;
            this.token = options.token;
        } else {
            throw new Error(
                "WebhookClient requires either a webhook 'url' or both 'id' and 'token'.",
            );
        }
        this.#rest = new REST(restOptions);
    }

    /** Splits a message payload into its query, JSON body and files, resolving the camelCase aliases and builders. */
    #prepare(
        options: string | WebhookMessageOptions,
        base: Record<string, string> = {},
    ): {
        query: string;
        json: Record<string, unknown>;
        files?: RESTFileAttachment[];
    } {
        const payload =
            typeof options === "string" ? { content: options } : options;
        const {
            thread_id: threadWire,
            threadId,
            avatarURL,
            allowedMentions,
            files,
            ...body
        } = payload;
        const thread_id = threadWire ?? threadId;
        // The wire names win when both spellings are given.
        if (avatarURL !== undefined && body.avatar_url === undefined)
            body.avatar_url = avatarURL;
        if (
            allowedMentions !== undefined &&
            body.allowed_mentions === undefined
        )
            body.allowed_mentions = allowedMentions;
        const params = new URLSearchParams(base);
        if (thread_id) params.set("thread_id", String(thread_id));
        const json: Record<string, unknown> = { ...body };
        if (body.embeds)
            json.embeds = body.embeds.map((e) =>
                "toJSON" in e ? e.toJSON() : e,
            );
        if (body.components)
            json.components = body.components.map((c) =>
                "toJSON" in c ? c.toJSON() : c,
            );
        const text = params.toString();
        return { query: text ? `?${text}` : "", json, files };
    }

    /** Sends a message to the webhook. */
    public async send(
        options: string | WebhookMessageOptions,
    ): Promise<APIMessage> {
        const { query, json, files } = this.#prepare(options, { wait: "true" });
        const path = `${Routes.webhook(this.id, this.token)}${query}`;
        return files?.length
            ? this.#rest.postWithFiles<APIMessage>(path, json, files)
            : this.#rest.post<APIMessage>(path, json);
    }

    /** Fetches a message this webhook sent (`threadId` for a message inside a thread). */
    public async fetchMessage(
        messageId: string,
        options: { threadId?: string } = {},
    ): Promise<APIMessage> {
        const query = options.threadId
            ? `?${new URLSearchParams({ thread_id: options.threadId })}`
            : "";
        return this.#rest.get<APIMessage>(
            `${Routes.webhookMessage(this.id, this.token, messageId)}${query}`,
        );
    }

    /** Edits a previously sent webhook message. Takes the same options as {@link WebhookClient.send}, files included. */
    public async editMessage(
        messageId: string,
        options: string | WebhookMessageOptions,
    ): Promise<APIMessage> {
        const { query, json, files } = this.#prepare(options);
        const path = `${Routes.webhookMessage(this.id, this.token, messageId)}${query}`;
        return files?.length
            ? this.#rest.patchWithFiles<APIMessage>(path, json, files)
            : this.#rest.patch<APIMessage>(path, json);
    }

    /** Deletes a previously sent webhook message. */
    public async deleteMessage(
        messageId: string,
        options: { threadId?: string } = {},
    ): Promise<void> {
        const query = options.threadId
            ? `?${new URLSearchParams({ thread_id: options.threadId })}`
            : "";
        await this.#rest.delete(
            `${Routes.webhookMessage(this.id, this.token, messageId)}${query}`,
        );
    }
}
