import { BaseStructure, User } from "./index.js";

/** A Discord webhook resource. */
export class Webhook extends BaseStructure {
    /** Webhook name. */ public name: string | null;
    /** Webhook token, when available. */ public token?: string;
    /** Webhook type. */ public type: number;
    /** Guild ID containing the webhook. */ public guildId?: string;
    /** Channel ID receiving webhook messages. */ public channelId?: string;
    /** User that owns/created the webhook. */ public user?: User;

    /** Creates a webhook from Discord API data. */
    public constructor(data: { id: string; name?: string | null; token?: string; type?: number; guild_id?: string; channel_id?: string; user?: ConstructorParameters<typeof User>[0] }) {
        super(data.id);
        this.name = data.name ?? null;
        this.token = data.token;
        this.type = data.type ?? 1;
        this.guildId = data.guild_id;
        this.channelId = data.channel_id;
        this.user = data.user ? new User(data.user) : undefined;
    }

    /** Returns the webhook execute URL when a token is available. */
    public url(): string | null { return this.token ? `https://discord.com/api/webhooks/${this.id}/${this.token}` : null; }
}
