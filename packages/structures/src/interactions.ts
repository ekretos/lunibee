/** Discord interaction type constants. */
export const InteractionType = {
  Ping: 1,
  ApplicationCommand: 2,
  MessageComponent: 3,
  ApplicationCommandAutocomplete: 4,
  ModalSubmit: 5,
} as const;
/** Discord interaction response type constants. */
export const InteractionResponseType = {
  Pong: 1,
  ChannelMessage: 4,
  DeferredChannelMessage: 5,
  DeferredMessageUpdate: 6,
  MessageUpdate: 7,
  Autocomplete: 8,
  Modal: 9,
} as const;
/** Data shared by Discord interactions. */
export interface InteractionData {
  /** Interaction identifier. */ id: string;
  /** Application identifier. */ application_id: string;
  /** Interaction type. */ type: number;
  /** Interaction token. */ token: string;
  /** Gateway/API version. */ version: number;
  /** Guild identifier. */ guild_id?: string;
  /** Channel identifier. */ channel_id?: string;
  /** Interaction-specific data. */ data?: Record<string, unknown>;
  [key: string]: unknown;
}
/** Options for an interaction response message. */
export interface InteractionReplyOptions {
  /** Message content. */ content?: string;
  /** Whether the response is ephemeral. */ ephemeral?: boolean;
  /** Message components. */ components?: unknown[];
  /** Message embeds. */ embeds?: unknown[];
  /** Discord message flags. */ flags?: number;
  [key: string]: unknown;
}
/** Transport required by an interaction structure. */
export interface InteractionClient {
  /** Sends the initial interaction callback. @param id Interaction identifier. @param token Interaction token. @param response Callback payload. @returns Discord response. @throws {Error} When REST fails. */ postInteractionResponse(
    id: string,
    token: string,
    response: InteractionResponse,
  ): Promise<unknown>;
  /** Edits the original interaction response. @param token Interaction token. @param data Message payload. @returns Discord response. @throws {Error} When REST fails. */ editInteractionReply(
    token: string,
    data: InteractionReplyOptions,
  ): Promise<unknown>;
  /** Deletes the original interaction response. @param token Interaction token. @returns Promise fulfilled after deletion. @throws {Error} When REST fails. */ deleteInteractionReply(
    token: string,
  ): Promise<void>;
  /** Sends a follow-up interaction webhook message. @param token Interaction token. @param data Message payload. @returns Discord response. @throws {Error} When REST fails. */ followUpInteraction(
    token: string,
    data: InteractionReplyOptions,
  ): Promise<unknown>;
}
/** A Discord interaction callback payload. */
export class InteractionResponse {
  /** Callback response type. */ public readonly type: number;
  /** Optional callback data. */ public readonly data?: InteractionReplyOptions;
  /** Creates a response payload. @param type Discord callback type. @param data Optional callback data. @throws {TypeError} If type is not finite. */ public constructor(
    type: number,
    data?: InteractionReplyOptions,
  ) {
    if (!Number.isFinite(type))
      throw new TypeError("Interaction response type must be finite.");
    this.type = type;
    this.data = data;
  }
  /** Serializes the response for Discord. @returns Discord callback payload. */ public toJSON(): {
    type: number;
    data?: InteractionReplyOptions;
  } {
    return this.data === undefined
      ? { type: this.type }
      : { type: this.type, data: this.data };
  }
  /** Creates an immediate message response. @param options Response message options. @returns Callback payload. */ public static message(
    options: InteractionReplyOptions,
  ): InteractionResponse {
    const data: InteractionReplyOptions = { ...options };
    if (options.ephemeral) {
      data.flags = (typeof options.flags === "number" ? options.flags : 0) | 64;
    }
    return new InteractionResponse(
      InteractionResponseType.ChannelMessage,
      data,
    );
  }
  /** Creates a deferred channel response. @param ephemeral Whether the eventual response is ephemeral. @returns Callback payload. */ public static defer(
    ephemeral = false,
  ): InteractionResponse {
    return new InteractionResponse(
      InteractionResponseType.DeferredChannelMessage,
      ephemeral ? { flags: 64 } : undefined,
    );
  }
  /** Creates a Pong response. @returns Callback payload. */ public static pong(): InteractionResponse {
    return new InteractionResponse(InteractionResponseType.Pong);
  }
}
/** Base interaction structure. */
export class Interaction<TData extends InteractionData = InteractionData> {
  /** Interaction identifier. */ public readonly id: string;
  /** Application identifier. */ public readonly applicationId: string;
  /** Interaction token. */ public readonly token: string;
  /** Guild identifier. */ public readonly guildId?: string;
  /** Channel identifier. */ public readonly channelId?: string;
  /** Interaction type. */ public readonly type: number;
  /** Raw interaction data. */ public readonly data: TData;
  /** Whether the initial response was sent. */ public replied = false;
  /** Whether the initial response was deferred. */ public deferred = false;
  readonly #client: InteractionClient;
  /** Creates an interaction from a Gateway payload. @param client Interaction transport. @param data Gateway interaction payload. @throws {TypeError} If required identifiers are missing. */ public constructor(
    client: InteractionClient,
    data: TData,
  ) {
    if (!data.id || !data.token)
      throw new TypeError("Interaction ID and token are required.");
    this.#client = client;
    this.id = data.id;
    this.applicationId = data.application_id;
    this.token = data.token;
    this.guildId = data.guild_id;
    this.channelId = data.channel_id;
    this.type = data.type;
    this.data = data;
  }
  /** Whether this interaction is an application command. @returns True for application command interactions. */ public isChatInputCommand(): this is CommandInteraction {
    return this.type === InteractionType.ApplicationCommand;
  }
  /** Whether this interaction is a message component. @returns True for component interactions. */ public isMessageComponent(): this is ComponentInteraction {
    return this.type === InteractionType.MessageComponent;
  }
  /** Whether this interaction is a modal submission. @returns True for modal submissions. */ public isModalSubmit(): this is ComponentInteraction {
    return this.type === InteractionType.ModalSubmit;
  }
  /** Whether this interaction is autocomplete. @returns True for autocomplete interactions. */ public isAutocomplete(): this is CommandInteraction {
    return this.type === InteractionType.ApplicationCommandAutocomplete;
  }
  /** Ensures the interaction has not already been acknowledged. @returns Nothing. @throws {Error} When already acknowledged. */ protected assertUnacknowledged(): void {
    if (this.replied || this.deferred)
      throw new Error("Interaction has already been acknowledged.");
  }
  /** Ensures the interaction has been acknowledged. @returns Nothing. @throws {Error} When not acknowledged. */ protected assertAcknowledged(): void {
    if (!this.replied && !this.deferred)
      throw new Error("Interaction has not been acknowledged.");
  }
  /** Sends the initial interaction response. @param options Response message options. @returns Discord response. @throws {Error} When already acknowledged or REST fails. */ public async reply(
    options: InteractionReplyOptions | string,
  ): Promise<unknown> {
    this.assertUnacknowledged();
    const payload =
      typeof options === "string" ? { content: options } : options;
    const result = await this.#client.postInteractionResponse(
      this.id,
      this.token,
      InteractionResponse.message(payload),
    );
    this.replied = true;
    return result;
  }
  /** Defers the initial interaction response. @param ephemeral Whether the eventual response is ephemeral. @returns Promise fulfilled after acknowledgement. @throws {Error} When already acknowledged or REST fails. */ public async deferReply(
    ephemeral = false,
  ): Promise<void> {
    this.assertUnacknowledged();
    await this.#client.postInteractionResponse(
      this.id,
      this.token,
      InteractionResponse.defer(ephemeral),
    );
    this.deferred = true;
  }
  /** Edits the original response. @param options Replacement message options. @returns Discord response. @throws {Error} When not acknowledged or REST fails. */ public editReply(
    options: InteractionReplyOptions,
  ): Promise<unknown> {
    this.assertAcknowledged();
    return this.#client.editInteractionReply(this.token, options);
  }
  /** Deletes the original response. @returns Promise fulfilled after deletion. @throws {Error} When not acknowledged or REST fails. */ public deleteReply(): Promise<void> {
    this.assertAcknowledged();
    return this.#client.deleteInteractionReply(this.token);
  }
  /** Sends a follow-up message using the interaction webhook. @param options Follow-up message options. @returns Discord response. @throws {Error} When REST fails. */ public followUp(
    options: InteractionReplyOptions | string,
  ): Promise<unknown> {
    const payload =
      typeof options === "string" ? { content: options } : options;
    return this.#client.followUpInteraction(this.token, payload);
  }
  /** Updates the message for a component interaction. */ public async update(
    options: InteractionReplyOptions | string,
  ): Promise<unknown> {
    this.assertUnacknowledged();
    const payload =
      typeof options === "string" ? { content: options } : options;
    const result = await this.#client.postInteractionResponse(
      this.id,
      this.token,
      new InteractionResponse(InteractionResponseType.MessageUpdate, payload),
    );
    this.replied = true;
    return result;
  }
}
/** Application command interaction. */
export class CommandInteraction extends Interaction {
  /** Invoked command name. @returns Command name or an empty string. */ public get commandName(): string {
    return typeof this.data.data?.name === "string" ? this.data.data.name : "";
  }
}
/** Message component interaction. */
export class ComponentInteraction extends Interaction {
  /** Component custom ID. @returns Custom ID or an empty string. */
  public get customId(): string {
    return typeof this.data.data?.custom_id === "string"
      ? this.data.data.custom_id
      : "";
  }
  /** Submitted select-menu values. @returns String values. */
  public get values(): string[] {
    return Array.isArray(this.data.data?.values)
      ? this.data.data.values.filter(
          (value): value is string => typeof value === "string",
        )
      : [];
  }
}

/** Creates a specialized interaction structure for a Gateway payload. @param client Interaction transport. @param data Gateway interaction payload. @returns Specialized interaction structure. @throws {TypeError} If required identifiers are missing. */
export function createInteraction(
  client: InteractionClient,
  data: InteractionData,
): Interaction {
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
