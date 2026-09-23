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

    // ── Autocomplete ───────────────────────────────────────────────────────────

    /** Returns the focused option's value (autocomplete), or the full option when `full` is true. @throws {TypeError} If no option is focused. */
    public getFocused(full: true): APIInteractionDataOption;
    public getFocused(full?: false): string | number | boolean;
    public getFocused(
        full = false,
    ): APIInteractionDataOption | string | number | boolean {
        const focused = this.#options.find((o) => o.focused);
        if (!focused) throw new TypeError("No focused option was provided.");
        return full ? focused : (focused.value ?? "");
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
