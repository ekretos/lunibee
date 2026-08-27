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

/** Discord component interaction type constants. */
export const ComponentType = {
    ActionRow: 1,
    Button: 2,
    StringSelect: 3,
    TextInput: 4,
    UserSelect: 5,
    RoleSelect: 6,
    MentionableSelect: 7,
    ChannelSelect: 8
} as const;

/** Base data shared by every interaction. */
export interface InteractionData {
    /** Unique interaction ID. */
    id: string;
    /** Application ID that received the interaction. */
    application_id: string;
    /** Interaction type. */
    type: number;
    /** Interaction token. */
    token: string;
    /** Interaction version. */
    version: number;
    /** Guild ID when the interaction originated in a guild. */
    guild_id?: string;
    /** Channel ID when the interaction originated in a channel. */
    channel_id?: string;
    /** Raw Discord interaction payload. */
    [key: string]: unknown;
}

/** Payload accepted when replying to an interaction. */
export interface InteractionReplyOptions {
    /** Message text. */
    content?: string;
    /** Whether the response is visible only to the invoking user. */
    ephemeral?: boolean;
    /** Components included with the response. */
    components?: unknown[];
    /** Embeds included with the response. */
    embeds?: unknown[];
    /** Arbitrary Discord message payload fields. */
    [key: string]: unknown;
}

/** A Discord interaction response builder. */
export class InteractionResponse {
    /** Response type. */
    public readonly type: number;
    /** Response message data. */
    public readonly data?: InteractionReplyOptions;

    /** Creates an interaction response. */
    public constructor(type: number, data?: InteractionReplyOptions) {
        this.type = type;
        this.data = data;
    }

    /** Returns the Discord API payload. */
    public toJSON(): { type: number; data?: InteractionReplyOptions } {
        return this.data === undefined ? { type: this.type } : { type: this.type, data: this.data };
    }

    /** Creates a normal channel-message response. */
    public static message(options: InteractionReplyOptions): InteractionResponse {
        return new InteractionResponse(InteractionResponseType.ChannelMessage, options);
    }

    /** Creates a deferred channel-message response. */
    public static defer(ephemeral = false): InteractionResponse {
        return new InteractionResponse(InteractionResponseType.DeferredChannelMessage, ephemeral ? { flags: 64 } : undefined);
    }

    /** Creates a Pong response. */
    public static pong(): InteractionResponse {
        return new InteractionResponse(InteractionResponseType.Pong);
    }
}

/** Common interface for interactions handled by Lunibee. */
export interface InteractionClient {
    /** Sends a response through Discord's interaction callback endpoint. */
    postInteractionResponse(id: string, token: string, response: InteractionResponse): Promise<unknown>;
    /** Edits the original interaction response. */
    editInteractionReply(token: string, data: InteractionReplyOptions): Promise<unknown>;
    /** Deletes the original interaction response. */
    deleteInteractionReply(token: string): Promise<void>;
}

/** Base interaction object with response lifecycle helpers. */
export class Interaction<TData extends InteractionData = InteractionData> {
    /** Interaction ID. */
    public readonly id: string;
    /** Application ID. */
    public readonly applicationId: string;
    /** Interaction token. */
    public readonly token: string;
    /** Guild ID, when present. */
    public readonly guildId?: string;
    /** Channel ID, when present. */
    public readonly channelId?: string;
    /** Interaction type. */
    public readonly type: number;
    /** Raw interaction data. */
    public readonly data: TData;
    /** Whether the interaction has already received an initial response. */
    public replied = false;
    /** Whether the interaction has been deferred. */
    public deferred = false;
    readonly #client: InteractionClient;

    /** Creates an interaction from a Discord Gateway payload. */
    public constructor(client: InteractionClient, data: TData) {
        this.#client = client;
        this.id = data.id;
        this.applicationId = data.application_id;
        this.token = data.token;
        this.guildId = data.guild_id;
        this.channelId = data.channel_id;
        this.type = data.type;
        this.data = data;
    }

    /** Sends the first response to the interaction. */
    public async reply(options: InteractionReplyOptions): Promise<unknown> {
        if (this.replied || this.deferred) throw new Error("Interaction has already been acknowledged");
        this.replied = true;
        return this.#client.postInteractionResponse(this.id, this.token, InteractionResponse.message(options));
    }

    /** Defers the interaction response. */
    public async deferReply(ephemeral = false): Promise<void> {
        if (this.replied || this.deferred) throw new Error("Interaction has already been acknowledged");
        this.deferred = true;
        await this.#client.postInteractionResponse(this.id, this.token, InteractionResponse.defer(ephemeral));
    }

    /** Edits the original interaction response. */
    public editReply(options: InteractionReplyOptions): Promise<unknown> {
        if (!this.replied && !this.deferred) throw new Error("Interaction has not been acknowledged");
        return this.#client.editInteractionReply(this.token, options);
    }

    /** Deletes the original interaction response. */
    public deleteReply(): Promise<void> {
        if (!this.replied && !this.deferred) throw new Error("Interaction has not been acknowledged");
        return this.#client.deleteInteractionReply(this.token);
    }
}

/** An application command interaction. */
export class CommandInteraction extends Interaction {
    /** Command name. */
    public get commandName(): string { return String(this.data.data && (this.data.data as Record<string, unknown>).name); }
}

/** A component interaction generated by a button or select menu. */
export class ComponentInteraction extends Interaction {
    /** Component custom ID. */
    public get customId(): string { return String((this.data.data as Record<string, unknown> | undefined)?.custom_id ?? ""); }
    /** Values selected by a select component. */
    public get values(): string[] { return ((this.data.data as Record<string, unknown> | undefined)?.values as string[] | undefined) ?? []; }
}

/** Creates the correct interaction class from a raw Discord payload. */
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
