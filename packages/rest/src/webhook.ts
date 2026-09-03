import { REST } from "./index.js";
import { Routes } from "./routes.js";
import type { APIEmbed, APIMessage } from "@lunibee/types";

export interface WebhookClientOptions {
    id?: string;
    token?: string;
    url?: string;
}

export interface WebhookMessageOptions {
    content?: string;
    username?: string;
    avatar_url?: string;
    tts?: boolean;
    embeds?: (APIEmbed | { toJSON(): APIEmbed })[];
    components?: any[];
    files?: any[];
    flags?: number;
    thread_id?: string;
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
            const match = options.url.match(
                /discord(?:app)?.com\/api\/webhooks\/(\d+)\/([A-Za-z0-9_-]+)/,
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

    /** Sends a message to the webhook. */
    public async send(
        options: string | WebhookMessageOptions,
    ): Promise<APIMessage> {
        const payload =
            typeof options === "string" ? { content: options } : options;
        const { thread_id, ...body } = payload;
        const query = thread_id
            ? `?thread_id=${thread_id}&wait=true`
            : `?wait=true`;
        const formattedEmbeds: APIEmbed[] | undefined = body.embeds?.map((e) =>
            "toJSON" in e ? e.toJSON() : e,
        );
        return this.#rest.post<APIMessage>(
            `${Routes.webhook(this.id, this.token)}${query}`,
            {
                ...body,
                embeds: formattedEmbeds,
            },
        );
    }

    /** Edits a previously sent webhook message. */
    public async editMessage(
        messageId: string,
        options: string | { content?: string; embeds?: any[] },
    ): Promise<any> {
        const payload =
            typeof options === "string" ? { content: options } : options;
        return this.#rest.patch(
            Routes.webhookMessage(this.id, this.token, messageId),
            payload,
        );
    }

    /** Deletes a previously sent webhook message. */
    public async deleteMessage(messageId: string): Promise<void> {
        await this.#rest.delete(
            Routes.webhookMessage(this.id, this.token, messageId),
        );
    }
}
