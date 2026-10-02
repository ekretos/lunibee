import { InteractionResponseEnum } from "@lunibee/types";
import { User, type ResourceContext } from "./base.js";
import { GuildMember } from "./resources.js";
// A cycle with index.ts: Message is only used lazily (in a getter), after both modules loaded.
import { Message } from "./index.js";

/** Discord interaction type constants. */
export const InteractionEnum = {
    Ping: 1,
    ApplicationCommand: 2,
    MessageComponent: 3,
    ApplicationCommandAutocomplete: 4,
    ModalSubmit: 5,
} as const;
/** One {@link InteractionEnum} value, usable as a type. */
export type InteractionEnum =
    (typeof InteractionEnum)[keyof typeof InteractionEnum];
// Re-export for consumers who import from structures directly
export {
    InteractionResponseEnum,
    InteractionResponseType,
} from "@lunibee/types";
/** Data shared by Discord interactions. */
export interface InteractionData {
    /** Interaction identifier. */
    id: string;
    /** Application identifier. */
    application_id: string;
    /** Interaction type. */
    type: number;
    /** Interaction token. */
    token: string;
    /** Gateway/API version. */
    version?: number;
    /** Guild identifier. */
    guild_id?: string;
    /** Channel identifier. */
    channel_id?: string;
    /** Interaction-specific data. */
    data?: Record<string, unknown>;
    [key: string]: unknown;
}
/** Options for an interaction response message. */
export interface InteractionReplyOptions {
    /** Message content. */
    content?: string;
    /** Whether the response is ephemeral. */
    ephemeral?: boolean;
    /** Message components. */
    components?: unknown[];
    /** Message embeds. */
    embeds?: unknown[];
    /** Discord message flags. */
    flags?: number;
    /** On `reply()` / `update()`: return the created message (one request, no `fetchReply()`). */
    withResponse?: boolean;
    [key: string]: unknown;
}
/** Transport required by an interaction structure. */
export interface InteractionClient {
    /** Sends the initial interaction callback. @param id Interaction identifier. @param token Interaction token. @param response Callback payload. @returns Discord response. @throws {Error} When REST fails. */
    postInteractionResponse(
        id: string,
        token: string,
        response: InteractionResponse,
    ): Promise<unknown>;
    /** Edits the original interaction response. @param token Interaction token. @param data Message payload. @returns Discord response. @throws {Error} When REST fails. */
    editInteractionReply(
        token: string,
        data: InteractionReplyOptions,
    ): Promise<unknown>;
    /** Deletes the original interaction response. @param token Interaction token. @returns Promise fulfilled after deletion. @throws {Error} When REST fails. */
    deleteInteractionReply(token: string): Promise<void>;
    /** Sends a follow-up interaction webhook message. @param token Interaction token. @param data Message payload. @returns Discord response. @throws {Error} When REST fails. */
    followUpInteraction(
        token: string,
        data: InteractionReplyOptions,
    ): Promise<unknown>;
    /** Reads, edits or deletes an interaction webhook message (`@original` or a follow-up ID). Optional; required for {@link Interaction.fetchReply}, {@link Interaction.editFollowUp} and {@link Interaction.deleteFollowUp}. */
    interactionWebhookMessage?(
        method: "GET" | "PATCH" | "DELETE",
        applicationId: string,
        token: string,
        messageId: string,
        data?: InteractionReplyOptions,
    ): Promise<unknown>;
    /** Lets structures built from an interaction (such as {@link Interaction.member}) act through the client. Optional. */
    readonly resourceContext?: ResourceContext;
}

/** Discord's ephemeral message flag. */
const EPHEMERAL = 64;
/** Application command types (`data.type`): slash, user context menu, message context menu. */
const COMMAND_CHAT_INPUT = 1;
const COMMAND_USER = 2;
const COMMAND_MESSAGE = 3;
/** Interaction tokens stay valid for 15 minutes. */
const TOKEN_LIFETIME_MS = 15 * 60_000;
const DISCORD_EPOCH = 1_420_070_400_000n;

/** Takes the local-only `withResponse` key off reply options. */
function splitWithResponse(options: InteractionReplyOptions | string): {
    withResponse: boolean;
    rest: InteractionReplyOptions | string;
} {
    if (typeof options === "string")
        return { withResponse: false, rest: options };
    const { withResponse, ...rest } = options;
    return { withResponse: withResponse === true, rest };
}

/** Turns `{ ephemeral: true }` into Discord's flag and drops the local-only key. */
function toMessageData(
    options: InteractionReplyOptions | string,
): InteractionReplyOptions {
    if (typeof options === "string") return { content: options };
    const { ephemeral, ...data } = options;
    if (ephemeral)
        data.flags =
            (typeof data.flags === "number" ? data.flags : 0) | EPHEMERAL;
    return data;
}

export { CommandOptions, type APIInteractionDataOption } from "./options.js";
import { CommandOptions, type APIInteractionDataOption } from "./options.js";

// ─── Response class ───────────────────────────────────────────────────────────

/** A Discord interaction callback payload. */
export class InteractionResponse {
    readonly type: number;
    readonly data?: InteractionReplyOptions;
    /** Ask Discord to return the created message (`?with_response=true`); not part of the body. */
    public withResponse = false;
    /** Creates a response payload. @param type Discord callback type. @param data Optional callback data. @throws {TypeError} If type is not finite. */
    public constructor(type: number, data?: InteractionReplyOptions) {
        if (!Number.isFinite(type))
            throw new TypeError("Interaction response type must be finite.");
        this.type = type;
        this.data = data;
    }
    /** Serializes the response for Discord. @returns Discord callback payload. */
    public toJSON(): {
        type: number;
        data?: InteractionReplyOptions;
    } {
        return this.data === undefined
            ? { type: this.type }
            : { type: this.type, data: this.data };
    }
    /** Creates an immediate message response. @param options Response message options. @returns Callback payload. */
    public static message(
        options: InteractionReplyOptions,
    ): InteractionResponse {
        return new InteractionResponse(
            InteractionResponseEnum.ChannelMessage,
            toMessageData(options),
        );
    }
    /** Creates a deferred channel response. @param ephemeral Whether the eventual response is ephemeral. @returns Callback payload. */
    public static defer(ephemeral = false): InteractionResponse {
        return new InteractionResponse(
            InteractionResponseEnum.DeferredChannelMessage,
            ephemeral ? { flags: EPHEMERAL } : undefined,
        );
    }
    /** Creates a Pong response. @returns Callback payload. */
    public static pong(): InteractionResponse {
        return new InteractionResponse(InteractionResponseEnum.Pong);
    }
}

// ─── Base Interaction ─────────────────────────────────────────────────────────

/** Base interaction structure. */
export class Interaction<TData extends InteractionData = InteractionData> {
    /** Interaction identifier. */
    public readonly id: string;
    /** Application identifier. */
    public readonly applicationId: string;
    /** Interaction token. */
    public readonly token: string;
    /** Guild identifier. */
    public readonly guildId?: string;
    /** Channel identifier. */
    public readonly channelId?: string;
    /** Interaction type. */
    public readonly type: number;
    /** Raw interaction data. */
    public readonly data: TData;
    /** Whether the initial response was sent. */
    public replied = false;
    /** Whether the initial response was deferred. */
    public deferred = false;
    readonly #client: InteractionClient;
    /** An initial response is in flight; a second one must not be sent. */
    #acknowledging = false;
    /** Creates an interaction from a Gateway payload. @param client Interaction transport. @param data Gateway interaction payload. @throws {TypeError} If required identifiers are missing. */
    public constructor(client: InteractionClient, data: TData) {
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
    /** The application command's own type (1 chat input, 2 user, 3 message); 0 when this is not a command. */
    #commandType(): number {
        if (this.type !== InteractionEnum.ApplicationCommand) return 0;
        const type = this.data.data?.type;
        return typeof type === "number" ? type : COMMAND_CHAT_INPUT;
    }
    /** Whether this interaction is any application command: slash or context menu. */
    public isCommand(): this is CommandInteraction {
        return this.type === InteractionEnum.ApplicationCommand;
    }
    /**
     * Whether this interaction is a slash (chat input) command. Since 0.2.2 this
     * is false for context-menu commands; use {@link isCommand} for both.
     */
    public isChatInputCommand(): this is CommandInteraction {
        return this.#commandType() === COMMAND_CHAT_INPUT;
    }
    /** Whether this interaction is a user or message context-menu command. */
    public isContextMenuCommand(): this is ContextMenuCommandInteraction {
        const type = this.#commandType();
        return type === COMMAND_USER || type === COMMAND_MESSAGE;
    }
    /** Whether this interaction is a user context-menu command (right-click a user). */
    public isUserContextMenuCommand(): this is ContextMenuCommandInteraction {
        return this.#commandType() === COMMAND_USER;
    }
    /** Whether this interaction is a message context-menu command (right-click a message). */
    public isMessageContextMenuCommand(): this is ContextMenuCommandInteraction {
        return this.#commandType() === COMMAND_MESSAGE;
    }
    /** The client context structures built from this interaction act through. */
    protected get resourceContext(): ResourceContext | undefined {
        return this.#client.resourceContext;
    }
    /**
     * Waits for this user to submit a modal, typically one this interaction
     * just opened with {@link showModal}.
     * @param options `time` (required, ms); optional `customId` and `filter`.
     * @returns The submission. @throws {Error} When time runs out first or no client is attached.
     * @example const submitted = await interaction.awaitModalSubmit({ time: 60_000, customId: "feedback" });
     */
    public awaitModalSubmit(options: {
        time: number;
        customId?: string;
        filter?: (
            interaction: ModalSubmitInteraction,
        ) => boolean | Promise<boolean>;
    }): Promise<ModalSubmitInteraction> {
        const collect = this.#client.resourceContext?.collectInteractions;
        if (!collect)
            return Promise.reject(
                new Error("This interaction is not attached to a client."),
            );
        if (!(options.time > 0))
            return Promise.reject(
                new RangeError("awaitModalSubmit needs a positive time."),
            );
        const userId = this.user?.id;
        const collector = collect({
            time: options.time,
            max: 1,
            filter: async (interaction) =>
                interaction.isModalSubmit() &&
                interaction.user?.id === userId &&
                (options.customId === undefined ||
                    interaction.customId === options.customId) &&
                (options.filter ? await options.filter(interaction) : true),
        });
        return collector.next() as Promise<ModalSubmitInteraction>;
    }
    /** Whether this interaction is a message component. @returns True for component interactions. */
    public isMessageComponent(): this is ComponentInteraction {
        return this.type === InteractionEnum.MessageComponent;
    }
    /** Whether this interaction is a modal submission. @returns True for modal submissions. */
    public isModalSubmit(): this is ModalSubmitInteraction {
        return this.type === InteractionEnum.ModalSubmit;
    }
    /** Whether this interaction is autocomplete. @returns True for autocomplete interactions. */
    public isAutocomplete(): this is AutocompleteInteraction {
        return this.type === InteractionEnum.ApplicationCommandAutocomplete;
    }
    /** Message component type of this interaction, or 0 when it is not a component. */
    #componentType(): number {
        return this.isMessageComponent()
            ? ((this.data.data?.component_type as number | undefined) ?? 0)
            : 0;
    }
    /** Whether this is a button interaction. */
    public isButton(): this is ComponentInteraction {
        return this.#componentType() === 2;
    }
    /** Whether this is a string select menu interaction. */
    public isStringSelectMenu(): this is ComponentInteraction {
        return this.#componentType() === 3;
    }
    /** Whether this is a user select menu interaction. */
    public isUserSelectMenu(): this is ComponentInteraction {
        return this.#componentType() === 5;
    }
    /** Whether this is a role select menu interaction. */
    public isRoleSelectMenu(): this is ComponentInteraction {
        return this.#componentType() === 6;
    }
    /** Whether this is a mentionable select menu interaction. */
    public isMentionableSelectMenu(): this is ComponentInteraction {
        return this.#componentType() === 7;
    }
    /** Whether this is a channel select menu interaction. */
    public isChannelSelectMenu(): this is ComponentInteraction {
        return this.#componentType() === 8;
    }
    /** Whether this is any select menu interaction. */
    public isAnySelectMenu(): this is ComponentInteraction {
        return [3, 5, 6, 7, 8].includes(this.#componentType());
    }
    /** Ensures the interaction has not already been acknowledged. @returns Nothing. @throws {Error} When already acknowledged. */
    protected assertUnacknowledged(): void {
        if (this.replied || this.deferred || this.#acknowledging)
            throw new Error("Interaction has already been acknowledged.");
    }
    /**
     * Sends the initial response exactly once. The in-flight flag is set
     * before the request, so two concurrent calls cannot both send; it is
     * cleared if the request fails so the caller may try again.
     */
    protected async acknowledge(
        response: InteractionResponse,
        state: "replied" | "deferred",
    ): Promise<unknown> {
        this.assertUnacknowledged();
        this.#acknowledging = true;
        try {
            const result = await this.postResponse(response);
            this[state] = true;
            return result;
        } finally {
            this.#acknowledging = false;
        }
    }
    /** The invoking user (from `member.user` in guilds, `user` in DMs). */
    public get user(): User | null {
        const raw =
            (this.data.member as { user?: unknown } | undefined)?.user ??
            this.data.user;
        return raw
            ? new User(raw as ConstructorParameters<typeof User>[0])
            : null;
    }
    /** The invoking guild member, or null outside a guild. */
    public get member(): GuildMember | null {
        const raw = this.data.member;
        if (!raw || !this.guildId) return null;
        return new GuildMember(
            {
                ...(raw as Omit<
                    ConstructorParameters<typeof GuildMember>[0],
                    "guild_id"
                >),
                guild_id: this.guildId,
            },
            this.#client.resourceContext,
        );
    }
    /** Unix timestamp (ms) at which the interaction was created, from its snowflake. */
    public get createdTimestamp(): number {
        return Number((BigInt(this.id) >> 22n) + DISCORD_EPOCH);
    }
    /** When the interaction token stops working (15 minutes after creation). */
    public get expiresAt(): Date {
        return new Date(this.createdTimestamp + TOKEN_LIFETIME_MS);
    }
    /** Whether the token has expired; no response, edit or follow-up can succeed after that. */
    public get isExpired(): boolean {
        return Date.now() >= this.createdTimestamp + TOKEN_LIFETIME_MS;
    }
    #webhookMessage(
        method: "GET" | "PATCH" | "DELETE",
        messageId: string,
        data?: InteractionReplyOptions,
    ): Promise<unknown> {
        if (!this.#client.interactionWebhookMessage)
            return Promise.reject(
                new Error(
                    "This interaction client does not support webhook message access.",
                ),
            );
        return this.#client.interactionWebhookMessage(
            method,
            this.applicationId,
            this.token,
            messageId,
            data,
        );
    }
    /** Fetches the original response message. */
    public fetchReply(): Promise<unknown> {
        this.assertAcknowledged();
        return this.#webhookMessage("GET", "@original");
    }
    /** Edits a follow-up message. @param messageId Follow-up message ID. */
    public editFollowUp(
        messageId: string,
        options: InteractionReplyOptions | string,
    ): Promise<unknown> {
        return this.#webhookMessage("PATCH", messageId, toMessageData(options));
    }
    /** Deletes a follow-up message. @param messageId Follow-up message ID. */
    public async deleteFollowUp(messageId: string): Promise<void> {
        await this.#webhookMessage("DELETE", messageId);
    }
    /** Ensures the interaction has been acknowledged. @returns Nothing. @throws {Error} When not acknowledged. */
    protected assertAcknowledged(): void {
        if (!this.replied && !this.deferred)
            throw new Error("Interaction has not been acknowledged.");
    }
    /** Posts a raw interaction response callback. */
    protected postResponse(response: InteractionResponse): Promise<unknown> {
        return this.#client.postInteractionResponse(
            this.id,
            this.token,
            response,
        );
    }
    /**
     * Sends a response and, when `withResponse` is set, turns the callback
     * resource Discord returns into the created message.
     */
    protected async acknowledgeWith(
        response: InteractionResponse,
        state: "replied" | "deferred",
        withResponse: boolean,
    ): Promise<unknown> {
        response.withResponse = withResponse;
        const result = await this.acknowledge(response, state);
        if (!withResponse) return result;
        const message = (result as { resource?: { message?: unknown } } | null)
            ?.resource?.message;
        return message
            ? new Message(
                  message as ConstructorParameters<typeof Message>[0],
                  this.#client.resourceContext,
              )
            : null;
    }
    /**
     * Sends the initial interaction response. With `withResponse: true` it
     * returns the created {@link Message} in the same request (no `fetchReply()`).
     * @throws {Error} When already acknowledged or REST fails.
     */
    public async reply(
        options: InteractionReplyOptions & { withResponse: true },
    ): Promise<Message | null>;
    public async reply(
        options: InteractionReplyOptions | string,
    ): Promise<unknown>;
    public async reply(
        options: InteractionReplyOptions | string,
    ): Promise<unknown> {
        const { withResponse, rest } = splitWithResponse(options);
        return this.acknowledgeWith(
            InteractionResponse.message(toMessageData(rest)),
            "replied",
            withResponse,
        );
    }
    /**
     * Defers the initial interaction response. `true` or `{ ephemeral: true }`
     * makes the eventual response private; `withResponse: true` returns the
     * placeholder message. @throws {Error} When already acknowledged or REST fails.
     */
    public async deferReply(options: {
        ephemeral?: boolean;
        withResponse: true;
    }): Promise<Message | null>;
    public async deferReply(
        options?: boolean | { ephemeral?: boolean; withResponse?: boolean },
    ): Promise<void>;
    public async deferReply(
        options:
            boolean | { ephemeral?: boolean; withResponse?: boolean } = false,
    ): Promise<Message | null | void> {
        const ephemeral =
            typeof options === "boolean" ? options : options.ephemeral === true;
        const withResponse =
            typeof options === "object" && options.withResponse === true;
        const result = await this.acknowledgeWith(
            InteractionResponse.defer(ephemeral),
            "deferred",
            withResponse,
        );
        if (withResponse) return result as Message | null;
    }
    /** Edits the original response. @param options Replacement message options. @returns Discord response. @throws {Error} When not acknowledged or REST fails. */
    public editReply(options: InteractionReplyOptions): Promise<unknown> {
        this.assertAcknowledged();
        return this.#client.editInteractionReply(
            this.token,
            toMessageData(options),
        );
    }
    /** Deletes the original response. @returns Promise fulfilled after deletion. @throws {Error} When not acknowledged or REST fails. */
    public deleteReply(): Promise<void> {
        this.assertAcknowledged();
        return this.#client.deleteInteractionReply(this.token);
    }
    /** Sends a follow-up message using the interaction webhook. @param options Follow-up message options. @returns Discord response. @throws {Error} When REST fails. */
    public followUp(
        options: InteractionReplyOptions | string,
    ): Promise<unknown> {
        return this.#client.followUpInteraction(
            this.token,
            toMessageData(options),
        );
    }
    /**
     * Updates the message a component is on. With `withResponse: true` it
     * returns the updated {@link Message}.
     */
    public async update(
        options: InteractionReplyOptions & { withResponse: true },
    ): Promise<Message | null>;
    public async update(
        options: InteractionReplyOptions | string,
    ): Promise<unknown>;
    public async update(
        options: InteractionReplyOptions | string,
    ): Promise<unknown> {
        const { withResponse, rest } = splitWithResponse(options);
        return this.acknowledgeWith(
            new InteractionResponse(
                InteractionResponseEnum.MessageUpdate,
                toMessageData(rest),
            ),
            "replied",
            withResponse,
        );
    }
    /** Opens a modal dialog in the user's client. @param modal Modal builder output or raw modal callback data. @returns Discord response. @throws {Error} When already acknowledged or REST fails. */
    public async showModal(
        modal:
            | {
                  toJSON(): {
                      custom_id: string;
                      title: string;
                      components: unknown[];
                  };
              }
            // No index signature: an interface such as the builder's
            // `APIModalComponent` (what `toJSON()` returns) must be assignable.
            | {
                  custom_id: string;
                  title: string;
                  components: readonly unknown[];
              },
    ): Promise<unknown> {
        const data =
            "toJSON" in modal && typeof modal.toJSON === "function"
                ? modal.toJSON()
                : modal;
        return this.acknowledge(
            new InteractionResponse(
                InteractionResponseEnum.Modal,
                data as InteractionReplyOptions,
            ),
            "replied",
        );
    }
}

// ─── CommandInteraction ───────────────────────────────────────────────────────

/** Application command interaction with fully typed option resolver. */
export class CommandInteraction extends Interaction {
    /** Typed option resolver. Access slash command options with full type safety. */
    public readonly options: CommandOptions;

    /** Invoked command name. @returns Command name or an empty string. */
    public get commandName(): string {
        return typeof this.data.data?.name === "string"
            ? this.data.data.name
            : "";
    }

    public constructor(client: InteractionClient, data: InteractionData) {
        super(client, data);
        const rawOptions =
            (data.data?.options as APIInteractionDataOption[]) ?? [];
        const resolved = (data.data?.resolved as Record<string, unknown>) ?? {};
        // Hand the resolver the *top-level* options. CommandOptions performs the
        // subcommand/group drill itself and records the names it walks through;
        // pre-drilling here would strip those wrappers before it sees them, so
        // getSubcommand()/getSubcommandGroup() would report null.
        this.options = new CommandOptions(rawOptions, resolved);
    }
}

// ─── ContextMenuCommandInteraction ───────────────────────────────────────────

/** A user or message context-menu command, with what was right-clicked. */
export class ContextMenuCommandInteraction extends CommandInteraction {
    #resolved(): Record<string, Record<string, unknown> | undefined> {
        return (this.data.data?.resolved ?? {}) as Record<
            string,
            Record<string, unknown> | undefined
        >;
    }
    /** ID of the user or message the command was used on. */
    public get targetId(): string | null {
        const id = this.data.data?.target_id;
        return typeof id === "string" ? id : null;
    }
    /** The user a user command was used on. */
    public get targetUser(): User | null {
        const id = this.targetId;
        const raw = id ? this.#resolved().users?.[id] : undefined;
        return raw
            ? new User(raw as ConstructorParameters<typeof User>[0])
            : null;
    }
    /** The member a user command was used on (in a guild), with member actions when attached to a client. */
    public get targetMember(): GuildMember | null {
        const id = this.targetId;
        const raw = id ? this.#resolved().members?.[id] : undefined;
        const user = id ? this.#resolved().users?.[id] : undefined;
        if (!raw || !user || !this.guildId) return null;
        return new GuildMember(
            {
                ...(raw as Omit<
                    ConstructorParameters<typeof GuildMember>[0],
                    "guild_id" | "user"
                >),
                user: user as ConstructorParameters<
                    typeof GuildMember
                >[0]["user"],
                guild_id: this.guildId,
            },
            this.resourceContext,
        );
    }
    /** The message a message command was used on. */
    public get targetMessage(): Message | null {
        const id = this.targetId;
        const raw = id ? this.#resolved().messages?.[id] : undefined;
        return raw
            ? new Message(
                  raw as unknown as ConstructorParameters<typeof Message>[0],
                  this.resourceContext,
              )
            : null;
    }
}

// ─── ComponentInteraction ─────────────────────────────────────────────────────

/** Message component interaction. */
export class ComponentInteraction extends Interaction {
    /** Gets component custom ID. */
    public get customId(): string {
        const id = this.data.data?.custom_id;
        return typeof id === "string" ? id : "";
    }
    /** ID of the message the component is on. */
    public get messageId(): string | undefined {
        return (this.data.message as { id?: string } | undefined)?.id;
    }
    /** Gets component type. */
    public get componentType(): number {
        const type = this.data.data?.component_type;
        return typeof type === "number" ? type : 0;
    }
    /** Gets selected values for select menu component interactions. */
    public get values(): string[] {
        const values = this.data.data?.values;
        return Array.isArray(values) ? (values as string[]) : [];
    }
    /** Defers updating the message to which the component was attached. */
    public async deferUpdate(options: {
        withResponse: true;
    }): Promise<Message | null>;
    public async deferUpdate(options?: {
        withResponse?: boolean;
    }): Promise<void>;
    public async deferUpdate(
        options: { withResponse?: boolean } = {},
    ): Promise<Message | null | void> {
        const withResponse = options.withResponse === true;
        const result = await this.acknowledgeWith(
            new InteractionResponse(
                InteractionResponseEnum.DeferredMessageUpdate,
            ),
            "deferred",
            withResponse,
        );
        if (withResponse) return result as Message | null;
    }
}

// ─── ModalSubmitInteraction ───────────────────────────────────────────────────

/** Represents a Discord modal submission interaction. */
export class ModalSubmitInteraction extends Interaction {
    /** Gets the submitted modal custom ID. */
    public get customId(): string {
        const id = this.data.data?.custom_id;
        return typeof id === "string" ? id : "";
    }

    /** Retrieves the text value for a specific text input custom ID. @param customId The custom_id of the text input component. @returns The submitted text, or undefined if not found. */
    public getInputValue(customId: string): string | undefined {
        const rows =
            (this.data.data?.components as
                | { components?: { custom_id?: string; value?: string }[] }[]
                | undefined) ?? [];
        for (const row of rows) {
            for (const comp of row.components ?? []) {
                if (comp.custom_id === customId) return comp.value;
            }
        }
        return undefined;
    }

    /** Retrieves the text value for a text input, throwing if missing. @param customId The custom_id of the text input component. @returns The submitted text. @throws {TypeError} If the field is not found. */
    public getRequiredInputValue(customId: string): string {
        const value = this.getInputValue(customId);
        if (value === undefined)
            throw new TypeError(
                `Modal input "${customId}" was not found in the submission.`,
            );
        return value;
    }
}

// ─── AutocompleteInteraction ──────────────────────────────────────────────────

/** Represents a Discord slash command autocomplete interaction. */
export class AutocompleteInteraction extends Interaction {
    /** Option resolver; use `options.getFocused()` for the focused value. */
    public readonly options: CommandOptions;

    public constructor(client: InteractionClient, data: InteractionData) {
        super(client, data);
        this.options = new CommandOptions(
            (data.data?.options as APIInteractionDataOption[]) ?? [],
        );
    }

    /** Gets the target command name. */
    public get commandName(): string {
        const name = this.data.data?.name;
        return typeof name === "string" ? name : "";
    }

    /** Gets the currently focused autocomplete option. */
    public get focusedOption():
        { name: string; value: unknown; type: number } | undefined {
        const options = this.data.data?.options;
        return findFocused(
            Array.isArray(options) ? (options as FocusableOption[]) : [],
        );
    }

    /** Responds to Discord with autocomplete choices. @param choices Array of name/value pairs to show. @throws {TypeError} If choices is not an array. */
    public async respond(
        choices: { name: string; value: string | number }[],
    ): Promise<void> {
        if (!Array.isArray(choices))
            throw new TypeError("Autocomplete choices must be an array.");
        const response = new InteractionResponse(
            InteractionResponseEnum.Autocomplete,
            { choices } as InteractionReplyOptions,
        );
        await this.acknowledge(response, "replied");
    }
}

/** An option as Discord sends it in autocomplete data. */
interface FocusableOption {
    name: string;
    value?: unknown;
    type: number;
    focused?: boolean;
    options?: FocusableOption[];
}

/** Recursively finds the focused option in a nested options tree. */
function findFocused(
    options: FocusableOption[],
): { name: string; value: unknown; type: number } | undefined {
    for (const opt of options) {
        if (opt.focused)
            return { name: opt.name, value: opt.value, type: opt.type };
        if (Array.isArray(opt.options)) {
            const found = findFocused(opt.options);
            if (found) return found;
        }
    }
    return undefined;
}

// ─── Factory ──────────────────────────────────────────────────────────────────

/**
 * Creates a specialized interaction structure for a Gateway payload.
 * @param client Interaction transport.
 * @param data Gateway interaction payload.
 * @returns Specialized interaction structure.
 * @throws {TypeError} If required identifiers are missing.
 */
export function createInteraction(
    client: InteractionClient,
    data: InteractionData,
): Interaction {
    switch (data.type) {
        case InteractionEnum.ApplicationCommand: {
            const commandType = data.data?.type;
            return commandType === COMMAND_USER ||
                commandType === COMMAND_MESSAGE
                ? new ContextMenuCommandInteraction(client, data)
                : new CommandInteraction(client, data);
        }
        case InteractionEnum.ApplicationCommandAutocomplete:
            return new AutocompleteInteraction(client, data);
        case InteractionEnum.MessageComponent:
            return new ComponentInteraction(client, data);
        case InteractionEnum.ModalSubmit:
            return new ModalSubmitInteraction(client, data);
        default:
            return new Interaction(client, data);
    }
}

/** @deprecated Use {@link InteractionEnum}. Removed in 0.3.0. */
export const InteractionType = InteractionEnum;
/** @deprecated Use {@link InteractionEnum}. Removed in 0.3.0. */
export type InteractionType = InteractionEnum;
