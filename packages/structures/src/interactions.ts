import { InteractionResponseType } from "@lunibee/types";

/** Discord interaction type constants. */
export const InteractionType = {
    Ping: 1,
    ApplicationCommand: 2,
    MessageComponent: 3,
    ApplicationCommandAutocomplete: 4,
    ModalSubmit: 5,
} as const;
// Re-export for consumers who import from structures directly
export { InteractionResponseType } from "@lunibee/types";
/** Data shared by Discord interactions. */
export interface InteractionData {
    /** Interaction identifier. */ id: string;
    /** Application identifier. */ application_id: string;
    /** Interaction type. */ type: number;
    /** Interaction token. */ token: string;
    /** Gateway/API version. */ version?: number;
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

// ─── Raw option type from Discord ────────────────────────────────────────────

/** Raw Discord application command interaction data option. */
export interface APIInteractionDataOption {
    name: string;
    type: number;
    value?: string | number | boolean;
    options?: APIInteractionDataOption[];
    focused?: boolean;
}

// ─── CommandOptions resolver ──────────────────────────────────────────────────

/** Application command option types mirroring Discord's enum. */
const OptionType = {
    SubCommand: 1,
    SubCommandGroup: 2,
    String: 3,
    Integer: 4,
    Boolean: 5,
    User: 6,
    Channel: 7,
    Role: 8,
    Mentionable: 9,
    Number: 10,
    Attachment: 11,
} as const;

/**
 * Typed resolver for application command options.
 * Attached as `CommandInteraction.options`.
 */
export class CommandOptions {
    readonly #options: APIInteractionDataOption[];
    readonly #resolved: Record<string, unknown>;

    /** @internal */
    public constructor(
        options: APIInteractionDataOption[],
        resolved: Record<string, unknown> = {},
    ) {
        let currentOptions = options;
        let group: string | null = null;
        let sub: string | null = null;

        // Drill down to the deepest options level for nested subcommands
        while (currentOptions.length === 1) {
            const opt = currentOptions[0]!;
            if (opt.type === OptionType.SubCommandGroup) {
                group = opt.name;
                currentOptions = opt.options ?? [];
            } else if (opt.type === OptionType.SubCommand) {
                sub = opt.name;
                currentOptions = opt.options ?? [];
            } else {
                break;
            }
        }

        this.#options = currentOptions;
        this.#resolved = resolved;
        this.#subcommandGroup = group;
        this.#subcommand = sub;
    }

    readonly #subcommandGroup: string | null;
    readonly #subcommand: string | null;

    /** Finds a raw option by name (case-insensitive). */
    #get(name: string): APIInteractionDataOption | undefined {
        return this.#options.find(
            (o) => o.name.toLowerCase() === name.toLowerCase(),
        );
    }

    // ── Subcommand resolution ──────────────────────────────────────────────────

    /** Returns the invoked subcommand name, or null if none. */
    public getSubcommand(required?: false): string | null;
    public getSubcommand(required: true): string;
    public getSubcommand(required = false): string | null {
        if (!this.#subcommand && required) {
            throw new TypeError("No subcommand was provided.");
        }
        return this.#subcommand;
    }

    /** Returns the invoked subcommand group name, or null if none. */
    public getSubcommandGroup(required?: false): string | null;
    public getSubcommandGroup(required: true): string;
    public getSubcommandGroup(required = false): string | null {
        if (!this.#subcommandGroup && required) {
            throw new TypeError("No subcommand group was provided.");
        }
        return this.#subcommandGroup;
    }

    // ── Primitive value options ────────────────────────────────────────────────

    /** Gets a string option. @param name Option name. @param required If true, throws when missing. */
    public getString(name: string, required?: false): string | null;
    public getString(name: string, required: true): string;
    public getString(name: string, required = false): string | null {
        const opt = this.#get(name);
        if (!opt || opt.type !== OptionType.String) {
            if (required)
                throw new TypeError(
                    `Required option "${name}" (string) is missing.`,
                );
            return null;
        }
        return typeof opt.value === "string" ? opt.value : null;
    }

    /** Gets an integer option. @param name Option name. @param required If true, throws when missing. */
    public getInteger(name: string, required?: false): number | null;
    public getInteger(name: string, required: true): number;
    public getInteger(name: string, required = false): number | null {
        const opt = this.#get(name);
        if (!opt || opt.type !== OptionType.Integer) {
            if (required)
                throw new TypeError(
                    `Required option "${name}" (integer) is missing.`,
                );
            return null;
        }
        return typeof opt.value === "number" ? Math.trunc(opt.value) : null;
    }

    /** Gets a number (float) option. @param name Option name. @param required If true, throws when missing. */
    public getNumber(name: string, required?: false): number | null;
    public getNumber(name: string, required: true): number;
    public getNumber(name: string, required = false): number | null {
        const opt = this.#get(name);
        if (!opt || opt.type !== OptionType.Number) {
            if (required)
                throw new TypeError(
                    `Required option "${name}" (number) is missing.`,
                );
            return null;
        }
        return typeof opt.value === "number" ? opt.value : null;
    }

    /** Gets a boolean option. @param name Option name. @param required If true, throws when missing. */
    public getBoolean(name: string, required?: false): boolean | null;
    public getBoolean(name: string, required: true): boolean;
    public getBoolean(name: string, required = false): boolean | null {
        const opt = this.#get(name);
        if (!opt || opt.type !== OptionType.Boolean) {
            if (required)
                throw new TypeError(
                    `Required option "${name}" (boolean) is missing.`,
                );
            return null;
        }
        return typeof opt.value === "boolean" ? opt.value : null;
    }

    // ── Resolved entity options ────────────────────────────────────────────────

    /** Gets the raw resolved user data for a user option. @param name Option name. @param required If true, throws when missing. */
    public getUser(
        name: string,
        required?: false,
    ): Record<string, unknown> | null;
    public getUser(name: string, required: true): Record<string, unknown>;
    public getUser(
        name: string,
        required = false,
    ): Record<string, unknown> | null {
        const opt = this.#get(name);
        if (!opt || opt.type !== OptionType.User) {
            if (required)
                throw new TypeError(
                    `Required option "${name}" (user) is missing.`,
                );
            return null;
        }
        const userId = String(opt.value);
        const resolved = (this.#resolved as any)?.users?.[userId] ?? null;
        if (!resolved && required)
            throw new TypeError(
                `Resolved user for option "${name}" is missing.`,
            );
        return resolved;
    }

    /** Gets the raw resolved channel data for a channel option. @param name Option name. @param required If true, throws when missing. */
    public getChannel(
        name: string,
        required?: false,
    ): Record<string, unknown> | null;
    public getChannel(name: string, required: true): Record<string, unknown>;
    public getChannel(
        name: string,
        required = false,
    ): Record<string, unknown> | null {
        const opt = this.#get(name);
        if (!opt || opt.type !== OptionType.Channel) {
            if (required)
                throw new TypeError(
                    `Required option "${name}" (channel) is missing.`,
                );
            return null;
        }
        const channelId = String(opt.value);
        const resolved = (this.#resolved as any)?.channels?.[channelId] ?? null;
        if (!resolved && required)
            throw new TypeError(
                `Resolved channel for option "${name}" is missing.`,
            );
        return resolved;
    }

    /** Gets the raw resolved role data for a role option. @param name Option name. @param required If true, throws when missing. */
    public getRole(
        name: string,
        required?: false,
    ): Record<string, unknown> | null;
    public getRole(name: string, required: true): Record<string, unknown>;
    public getRole(
        name: string,
        required = false,
    ): Record<string, unknown> | null {
        const opt = this.#get(name);
        if (!opt || opt.type !== OptionType.Role) {
            if (required)
                throw new TypeError(
                    `Required option "${name}" (role) is missing.`,
                );
            return null;
        }
        const roleId = String(opt.value);
        const resolved = (this.#resolved as any)?.roles?.[roleId] ?? null;
        if (!resolved && required)
            throw new TypeError(
                `Resolved role for option "${name}" is missing.`,
            );
        return resolved;
    }

    /** Gets the raw resolved user or role data for a mentionable option. @param name Option name. @param required If true, throws when missing. */
    public getMentionable(
        name: string,
        required?: false,
    ): Record<string, unknown> | null;
    public getMentionable(
        name: string,
        required: true,
    ): Record<string, unknown>;
    public getMentionable(
        name: string,
        required = false,
    ): Record<string, unknown> | null {
        const opt = this.#get(name);
        if (!opt || opt.type !== OptionType.Mentionable) {
            if (required)
                throw new TypeError(
                    `Required option "${name}" (mentionable) is missing.`,
                );
            return null;
        }
        const id = String(opt.value);
        const resolved =
            (this.#resolved as any)?.users?.[id] ??
            (this.#resolved as any)?.roles?.[id] ??
            null;
        if (!resolved && required)
            throw new TypeError(
                `Resolved mentionable for option "${name}" is missing.`,
            );
        return resolved;
    }

    /** Gets the raw resolved attachment data for an attachment option. @param name Option name. @param required If true, throws when missing. */
    public getAttachment(
        name: string,
        required?: false,
    ): Record<string, unknown> | null;
    public getAttachment(name: string, required: true): Record<string, unknown>;
    public getAttachment(
        name: string,
        required = false,
    ): Record<string, unknown> | null {
        const opt = this.#get(name);
        if (!opt || opt.type !== OptionType.Attachment) {
            if (required)
                throw new TypeError(
                    `Required option "${name}" (attachment) is missing.`,
                );
            return null;
        }
        const attachmentId = String(opt.value);
        const resolved =
            (this.#resolved as any)?.attachments?.[attachmentId] ?? null;
        if (!resolved && required)
            throw new TypeError(
                `Resolved attachment for option "${name}" is missing.`,
            );
        return resolved;
    }

    /** Returns the raw option list for advanced use cases. */
    public get raw(): readonly APIInteractionDataOption[] {
        return this.#options;
    }
}

// ─── Response class ───────────────────────────────────────────────────────────

/** A Discord interaction callback payload. */
export class InteractionResponse {
    readonly type: number;
    readonly data?: InteractionReplyOptions;
    /** Creates a response payload. @param type Discord callback type. @param data Optional callback data. @throws {TypeError} If type is not finite. */
    public constructor(type: number, data?: InteractionReplyOptions) {
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
            data.flags =
                (typeof options.flags === "number" ? options.flags : 0) | 64;
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

// ─── Base Interaction ─────────────────────────────────────────────────────────

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
    /** Whether this interaction is a modal submission. @returns True for modal submissions. */ public isModalSubmit(): this is ModalSubmitInteraction {
        return this.type === InteractionType.ModalSubmit;
    }
    /** Whether this interaction is autocomplete. @returns True for autocomplete interactions. */ public isAutocomplete(): this is AutocompleteInteraction {
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
    /** Posts a raw interaction response callback. */
    protected postResponse(response: InteractionResponse): Promise<unknown> {
        return this.#client.postInteractionResponse(
            this.id,
            this.token,
            response,
        );
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
            new InteractionResponse(
                InteractionResponseType.MessageUpdate,
                payload,
            ),
        );
        this.replied = true;
        return result;
    }
    /** Opens a modal dialog in the user's client. @param modal Modal builder output or raw modal callback data. @returns Discord response. @throws {Error} When already acknowledged or REST fails. */
    public async showModal(modal: {
        custom_id: string;
        title: string;
        components: unknown[];
        [key: string]: unknown;
    }): Promise<unknown> {
        this.assertUnacknowledged();
        const result = await this.#client.postInteractionResponse(
            this.id,
            this.token,
            new InteractionResponse(
                InteractionResponseType.Modal,
                modal as InteractionReplyOptions,
            ),
        );
        this.replied = true;
        return result;
    }
}

// ─── CommandInteraction ───────────────────────────────────────────────────────

/** Application command interaction with fully typed option resolver. */
export class CommandInteraction extends Interaction {
    /** Typed option resolver. Access slash command options with full type safety. */
    public readonly options: CommandOptions;

    /** Invoked command name. @returns Command name or an empty string. */ public get commandName(): string {
        return typeof this.data.data?.name === "string"
            ? this.data.data.name
            : "";
    }

    public constructor(client: InteractionClient, data: InteractionData) {
        super(client, data);
        const rawOptions =
            (data.data?.options as APIInteractionDataOption[]) ?? [];
        const resolved = (data.data?.resolved as Record<string, unknown>) ?? {};
        // If a subcommand is present, drill into its options for the resolver
        const sub = rawOptions.find(
            (o) =>
                o.type === 1 /* SubCommand */ ||
                o.type === 2 /* SubCommandGroup */,
        );
        this.options = new CommandOptions(sub?.options ?? rawOptions, resolved);
    }
}

// ─── ComponentInteraction ─────────────────────────────────────────────────────

/** Message component interaction. */
export class ComponentInteraction extends Interaction {
    /** Gets component custom ID. */
    public get customId(): string {
        return (this.data as any)?.data?.custom_id ?? "";
    }
    /** Gets component type. */
    public get componentType(): number {
        return (this.data as any)?.data?.component_type ?? 0;
    }
    /** Gets selected values for select menu component interactions. */
    public get values(): string[] {
        return (this.data as any)?.data?.values ?? [];
    }
    /** Defers updating the message to which the component was attached. */
    public async deferUpdate(): Promise<void> {
        this.assertUnacknowledged();
        await this.postResponse(
            new InteractionResponse(
                InteractionResponseType.DeferredMessageUpdate,
            ),
        );
        this.deferred = true;
    }
    /** Updates the message to which the component was attached. */
    public override async update(
        options: InteractionReplyOptions | string,
    ): Promise<unknown> {
        this.assertUnacknowledged();
        const payload =
            typeof options === "string" ? { content: options } : options;
        const result = await this.postResponse(
            new InteractionResponse(
                InteractionResponseType.MessageUpdate,
                payload,
            ),
        );
        this.replied = true;
        return result;
    }
}

// ─── ModalSubmitInteraction ───────────────────────────────────────────────────

/** Represents a Discord modal submission interaction. */
export class ModalSubmitInteraction extends Interaction {
    /** Gets the submitted modal custom ID. */
    public get customId(): string {
        return (this.data as any)?.data?.custom_id ?? "";
    }

    /** Retrieves the text value for a specific text input custom ID. @param customId The custom_id of the text input component. @returns The submitted text, or undefined if not found. */
    public getInputValue(customId: string): string | undefined {
        const rows = (this.data as any)?.data?.components ?? [];
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
    /** Gets the target command name. */
    public get commandName(): string {
        return (this.data as any)?.data?.name ?? "";
    }

    /** Gets the currently focused autocomplete option. */
    public get focusedOption():
        { name: string; value: unknown; type: number } | undefined {
        const options = (this.data as any)?.data?.options ?? [];
        return findFocused(options);
    }

    /** Responds to Discord with autocomplete choices. @param choices Array of name/value pairs to show. @throws {TypeError} If choices is not an array. */
    public async respond(
        choices: { name: string; value: string | number }[],
    ): Promise<void> {
        if (!Array.isArray(choices))
            throw new TypeError("Autocomplete choices must be an array.");
        const response = new InteractionResponse(
            InteractionResponseType.Autocomplete,
            { choices } as InteractionReplyOptions,
        );
        await this.postResponse(response);
        this.replied = true;
    }
}

/** Recursively finds the focused option in a nested options tree. */
function findFocused(
    options: any[],
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
        case InteractionType.ApplicationCommand:
            return new CommandInteraction(client, data);
        case InteractionType.ApplicationCommandAutocomplete:
            return new AutocompleteInteraction(client, data);
        case InteractionType.MessageComponent:
            return new ComponentInteraction(client, data);
        case InteractionType.ModalSubmit:
            return new ModalSubmitInteraction(client, data);
        default:
            return new Interaction(client, data);
    }
}
