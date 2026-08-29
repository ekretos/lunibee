/** Discord interaction type constants. */
export const InteractionType = { Ping: 1, ApplicationCommand: 2, MessageComponent: 3, ApplicationCommandAutocomplete: 4, ModalSubmit: 5 } as const;
/** Discord interaction response type constants. */
export const InteractionResponseType = { Pong: 1, ChannelMessage: 4, DeferredChannelMessage: 5, DeferredMessageUpdate: 6, MessageUpdate: 7, Autocomplete: 8, Modal: 9 } as const;
/** Shared interaction payload data. */
export interface InteractionData { id: string; application_id: string; type: number; token: string; version: number; guild_id?: string; channel_id?: string; data?: Record<string, unknown>; [key: string]: unknown; }
/** Message response options. */
export interface InteractionReplyOptions { content?: string; ephemeral?: boolean; components?: unknown[]; embeds?: unknown[]; flags?: number; [key: string]: unknown; }
/** Transport required by interaction structures. */
export interface InteractionClient { postInteractionResponse(id: string, token: string, response: InteractionResponse): Promise<unknown>; editInteractionReply(token: string, data: InteractionReplyOptions): Promise<unknown>; deleteInteractionReply(token: string): Promise<void>; }
/** Discord modal component payload. */
export interface ModalOptions { customId: string; title: string; components: unknown[]; }
/** Discord autocomplete response choices. */
export interface AutocompleteChoice { name: string; value: string | number; }
/** Interaction callback payload. */
export class InteractionResponse {
    /** Response type. */ public readonly type: number; /** Response data. */ public readonly data?: InteractionReplyOptions;
    /** Creates a response payload. */ public constructor(type: number, data?: InteractionReplyOptions) { if (!Number.isInteger(type) || type < 1 || type > 10) throw new RangeError("Invalid interaction response type."); this.type = type; this.data = data; }
    /** Serializes the response. */ public toJSON(): { type: number; data?: InteractionReplyOptions } { return this.data === undefined ? { type: this.type } : { type: this.type, data: this.data }; }
    /** Creates an immediate message response. */ public static message(options: InteractionReplyOptions): InteractionResponse { return new InteractionResponse(InteractionResponseType.ChannelMessage, options); }
    /** Creates a deferred channel response. */ public static defer(ephemeral = false): InteractionResponse { return new InteractionResponse(InteractionResponseType.DeferredChannelMessage, ephemeral ? { flags: 64 } : undefined); }
    /** Creates a deferred component update response. */ public static deferUpdate(): InteractionResponse { return new InteractionResponse(InteractionResponseType.DeferredMessageUpdate); }
    /** Creates a Pong response. */ public static pong(): InteractionResponse { return new InteractionResponse(InteractionResponseType.Pong); }
    /** Creates a message-update response. */ public static update(options: InteractionReplyOptions): InteractionResponse { return new InteractionResponse(InteractionResponseType.MessageUpdate, options); }
    /** Creates an autocomplete response. */ public static autocomplete(choices: AutocompleteChoice[]): InteractionResponse { if (choices.length > 25) throw new RangeError("Autocomplete responses cannot contain more than 25 choices."); return new InteractionResponse(InteractionResponseType.Autocomplete, { choices } as InteractionReplyOptions); }
    /** Creates a modal response. */ public static modal(options: ModalOptions): InteractionResponse { if (!options.customId || options.customId.length > 100) throw new RangeError("Modal custom ID must contain 1-100 characters."); if (!options.title || options.title.length > 45) throw new RangeError("Modal title must contain 1-45 characters."); if (!Array.isArray(options.components) || options.components.length > 5) throw new RangeError("A modal cannot contain more than 5 action rows."); return new InteractionResponse(InteractionResponseType.Modal, options as unknown as InteractionReplyOptions); }
}
/** Base interaction structure with acknowledgement lifecycle. */
export class Interaction<TData extends InteractionData = InteractionData> {
    /** Interaction ID. */ public readonly id: string; /** Application ID. */ public readonly applicationId: string; /** Interaction token. */ public readonly token: string; /** Guild ID. */ public readonly guildId?: string; /** Channel ID. */ public readonly channelId?: string; /** Interaction type. */ public readonly type: number; /** Raw interaction data. */ public readonly data: TData; /** Whether it has been replied to. */ public replied = false; /** Whether it has been deferred. */ public deferred = false; readonly #client: InteractionClient;
    /** Creates an interaction. */ public constructor(client: InteractionClient, data: TData) { if (!data.id || !data.token || !data.application_id) throw new TypeError("Interaction ID, application ID, and token are required."); this.#client = client; this.id = data.id; this.applicationId = data.application_id; this.token = data.token; this.guildId = data.guild_id; this.channelId = data.channel_id; this.type = data.type; this.data = data; }
    /** Replies to the interaction. */ public async reply(options: InteractionReplyOptions): Promise<unknown> { this.assertUnacknowledged(); const result = await this.#client.postInteractionResponse(this.id, this.token, InteractionResponse.message(options)); this.replied = true; return result; }
    /** Defers the interaction. */ public async deferReply(ephemeral = false): Promise<void> { this.assertUnacknowledged(); await this.#client.postInteractionResponse(this.id, this.token, InteractionResponse.defer(ephemeral)); this.deferred = true; }
    /** Defers a component update. */ public async deferUpdate(): Promise<void> { this.assertUnacknowledged(); await this.#client.postInteractionResponse(this.id, this.token, InteractionResponse.deferUpdate()); this.deferred = true; }
    /** Updates the original message. */ public async update(options: InteractionReplyOptions): Promise<unknown> { this.assertUnacknowledged(); const result = await this.#client.postInteractionResponse(this.id, this.token, InteractionResponse.update(options)); this.replied = true; return result; }
    /** Sends a modal as the initial response. */ public async showModal(options: ModalOptions): Promise<void> { this.assertUnacknowledged(); await this.#client.postInteractionResponse(this.id, this.token, InteractionResponse.modal(options)); this.replied = true; }
    /** Edits the original response. */ public editReply(options: InteractionReplyOptions): Promise<unknown> { this.assertAcknowledged(); return this.#client.editInteractionReply(this.token, options); }
    /** Deletes the original response. */ public deleteReply(): Promise<void> { this.assertAcknowledged(); return this.#client.deleteInteractionReply(this.token); }
    /** Returns whether the interaction has been acknowledged. */ public isRepliable(): boolean { return !this.replied && !this.deferred; }
    protected assertUnacknowledged(): void { if (this.replied || this.deferred) throw new Error("Interaction has already been acknowledged."); }
    protected assertAcknowledged(): void { if (!this.replied && !this.deferred) throw new Error("Interaction has not been acknowledged."); }
}
/** Application command interaction. */ export class CommandInteraction extends Interaction { /** Invoked command name. */ public get commandName(): string { return typeof this.data.data?.name === "string" ? this.data.data.name : ""; } }
/** Message component interaction. */ export class ComponentInteraction extends Interaction { /** Component custom ID. */ public get customId(): string { return typeof this.data.data?.custom_id === "string" ? this.data.data.custom_id : ""; } /** Selected values. */ public get values(): string[] { return Array.isArray(this.data.data?.values) ? this.data.data.values.filter((value): value is string => typeof value === "string") : []; } }
/** Modal submission interaction. */ export class ModalSubmitInteraction extends Interaction { /** Modal custom ID. */ public get customId(): string { return typeof this.data.data?.custom_id === "string" ? this.data.data.custom_id : ""; } }
/** Creates a specialized interaction structure. */ export function createInteraction(client: InteractionClient, data: InteractionData): Interaction { switch (data.type) { case InteractionType.ApplicationCommand: case InteractionType.ApplicationCommandAutocomplete: return new CommandInteraction(client, data); case InteractionType.MessageComponent: return new ComponentInteraction(client, data); case InteractionType.ModalSubmit: return new ModalSubmitInteraction(client, data); default: return new Interaction(client, data); } }
