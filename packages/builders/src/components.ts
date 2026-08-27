/** Discord component type constants. */
export const ComponentType = { ActionRow: 1, Button: 2, StringSelect: 3, TextInput: 4, UserSelect: 5, RoleSelect: 6, MentionableSelect: 7, ChannelSelect: 8 } as const;

/** Discord button style constants. */
export const ButtonStyle = { Primary: 1, Secondary: 2, Success: 3, Danger: 4, Link: 5 } as const;

/** Builds a Discord action row from component builders. */
export class ActionRowBuilder<T extends { toJSON(): unknown }> {
    readonly #components: T[] = [];
    /** Adds components to the row. */
    public addComponents(...components: T[]): this { this.#components.push(...components); return this; }
    /** Returns the Discord API representation. */
    public toJSON(): { type: 1; components: unknown[] } { return { type: ComponentType.ActionRow, components: this.#components.map(component => component.toJSON()) }; }
}

/** Builds Discord select menu components. */
export class StringSelectBuilder {
    readonly #data: Record<string, unknown> = { type: ComponentType.StringSelect };
    /** Sets the select custom ID. */
    public setCustomId(customId: string): this { this.#data.custom_id = customId; return this; }
    /** Sets the placeholder. */
    public setPlaceholder(placeholder: string): this { this.#data.placeholder = placeholder; return this; }
    /** Sets the minimum selection count. */
    public setMinValues(min: number): this { this.#data.min_values = min; return this; }
    /** Sets the maximum selection count. */
    public setMaxValues(max: number): this { this.#data.max_values = max; return this; }
    /** Adds string select options. */
    public addOptions(...options: Array<{ label: string; value: string; description?: string; emoji?: unknown; default?: boolean }>): this { this.#data.options = [...((this.#data.options as unknown[]) ?? []), ...options]; return this; }
    /** Returns the Discord API representation. */
    public toJSON(): Record<string, unknown> { return structuredClone(this.#data); }
}
