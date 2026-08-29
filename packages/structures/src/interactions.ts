/** Discord interaction type constants. */
export const InteractionType = {
    Ping: 1,
    ApplicationCommand: 2,
    MessageComponent: 3,
    ApplicationCommandAutocomplete: 4,
    ModalSubmit: 5
} as const;

/** Discord interaction response type constants. */
export const InteractionResponseType = {
    Pong: 1,
    ChannelMessage: 4,
    DeferredChannelMessage: 5,
    DeferredMessageUpdate: 6,
    MessageUpdate: 7,
    Autocomplete: 8,
    Modal: 9
} as const;

/** Data shared by Discord interactions. */
export interface InteractionData {
    id: string;
    application_id: string;
    type: number;
    token: string;
    version: number;
    guild_id?: string;
    channel_id?: string;
    data?: Record<string, unknown>;
    [key: string]: unknown;
}

/** Options for an interaction response message. */
export interface InteractionReplyOptions {
    content?: string;
    ephemeral?: boolean;
    components?: unknown[];
    embeds?: unknown[];
    flags?: number;
    [key: string]: unknown;
}

/** Transport required by an interaction structure. */
export interface InteractionClient {
    postInteractionResponse(id: string, token: string, response: InteractionResponse): Promise<unknown>;
    editInteractionReply(token: string, data: InteractionReplyOptions): Promise<unknown>;
    deleteInteractionReply(token: string): Promise<void>;
}

/** A Discord interaction callback payload. */
export class InteractionResponse {
    public readonly type: number;
    public readonly data?: InteractionReplyOptions;

    /** Creates a response payload. */
    public constructor(type: number, data?: InteractionReplyOptions) {
        this.type = type;
        this.data = data;
    }

    /** Serializes the response for Discord. */
    public toJSON(): { type: number; data?: InteractionReplyOptions } {
        return this.data === undefined ? { type: this.type } : { type: this.type, data: this.data };
    }

    /** Creates an immediate message response. */
    public static message(options: InteractionReplyOptions): InteractionResponse {
        return new InteractionResponse(InteractionResponseType.ChannelMessage, options);
    }

    /** Creates a deferred channel response. */
    public static defer(ephemeral = false): InteractionResponse {
        return new InteractionResponse(
            InteractionResponseType.DeferredChannelMessage,
            ephemeral ? { flags: 64 } : undefined
        );
    }

    /** Creates a Pong response. */
    public static pong(): InteractionResponse {
        return new InteractionResponse(InteractionResponseType.Pong);
    }
}

/** Base interaction structure. */
export class Interaction<TData extends InteractionData = InteractionData> {
    public readonly id: string;
    public readonly applicationId: string;
    public readonly token: string;
    public readonly guildId?: string;
    public readonly channelId?: string;
    public readonly type: number;
    public readonly data: TData;
    public replied = false;
    public deferred = false;
    readonly #client: InteractionClient;

    /** Creates an interaction from a Gateway payload. */
    public constructor(client: InteractionClient, data: TData) {
        if (!data.id || !data.token) throw new TypeError("Interaction ID and token are required.");
        this.#client = client;
        this.id = data.id;
        this.applicationId = data.application_id;
        this.token = data.token;
        this.guildId = data.guild_id;
        this.channelId = data.channel_id;
        this.type = data.type;
        this.data = data;
    }

    /** Ensures the interaction has not already been acknowledged. */
    protected assertUnacknowledged(): void {
        if (this.replied || this.deferred) throw new Error("Interaction has already been acknowledged.");
    }

    /** Ensures the interaction has already been acknowledged. */
    protected assertAcknowledged(): void {
        if (!this.replied && !this.deferred) throw new Error("Interaction has not been acknowledged.");
    }

    /** Sends the initial interaction response. */
    public async reply(options: InteractionReplyOptions): Promise<unknown> {
        this.assertUnacknowledged();
        const result = await this.#client.postInteractionResponse(
            this.id,
            this.token,
            InteractionResponse.message(options)
        );
        this.replied = true;
        return result;
    }

    /** Defers the initial interaction response. */
    public async deferReply(ephemeral = false): Promise<void> {
        this.assertUnacknowledged();
        await this.#client.postInteractionResponse(
            this.id,
            this.token,
            InteractionResponse.defer(ephemeral)
        );
        this.deferred = true;
    }

    /** Edits the original response. */
    public editReply(options: InteractionReplyOptions): Promise<unknown> {
        this.assertAcknowledged();
        return this.#client.editInteractionReply(this.token, options);
    }

    /** Deletes the original response. */
    public deleteReply(): Promise<void> {
        this.assertAcknowledged();
        return this.#client.deleteInteractionReply(this.token);
    }
}

/** Application command interaction. */
export class CommandInteraction extends Interaction {
    /** Invoked command name. */
    public get commandName(): string {
        return typeof this.data.data?.name === "string" ? this.data.data.name : "";
    }
}

/** Message component interaction. */
export class ComponentInteraction extends Interaction {
    /** Component custom ID. */
    public get customId(): string {
        return typeof this.data.data?.custom_id === "string" ? this.data.data.custom_id : "";
    }

    /** Submitted select-menu values. */
    public get values(): string[] {
        return Array.isArray(this.data.data?.values)
            ? this.data.data.values.filter((value): value is string => typeof value === "string")
            : [];
    }
}

/** Creates a specialized interaction structure for a Gateway payload. */
export function createInteraction(client: InteractionClient, data: InteractionData): Interaction {
    switch (data.type) {
        case InteractionType.ApplicationCommand:
        case InteractionType.ApplicationCommandAutocomplete:
            return new CommandInteraction(client, data);
        case InteractionType.MessageComponent:
        case InteractionType.ModalSubmit:
            return new ComponentInteraction(client, data);
        default:
            return new Interaction(client, data);
    }
}
