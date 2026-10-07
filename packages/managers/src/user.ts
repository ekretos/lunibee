import { ResourceManager } from "./base.js";
import { User } from "@lunibee/structures";
import { type REST, Routes } from "@lunibee/rest";
import type { APIChannel } from "@lunibee/types";

/** A guild as `GET /users/@me/guilds` lists it. */
export interface APIPartialGuild {
    id: string;
    name: string;
    icon: string | null;
    owner: boolean;
    permissions: string;
    features: string[];
    approximate_member_count?: number;
    approximate_presence_count?: number;
}

type UserData = ConstructorParameters<typeof User>[0];

export interface UserEditOptions {
    username?: string;
    avatar?: string | null;
}

export class UserManager extends ResourceManager<string, User> {
    readonly #rest: REST;
    public constructor(rest: REST) {
        super(
            async (id) =>
                new User(await rest.get<UserData>(Routes.userById(id))),
            (user) => user.id,
        );
        this.#rest = rest;
    }

    /** Gets the currently logged-in bot user. */
    public async fetchMe(): Promise<User> {
        const data = await this.#rest.get<UserData>("/users/@me");
        return this.upsert(new User(data));
    }

    /** Modifies the currently logged-in bot user. */
    public async editMe(options: UserEditOptions): Promise<User> {
        const data = await this.#rest.patch<UserData>("/users/@me", options);
        return this.upsert(new User(data));
    }

    /** Lists the guilds the bot is in, one page at a time (`limit` 1-200, `before` / `after` guild-ID cursors). */
    public async fetchGuilds(
        options: {
            limit?: number;
            before?: string;
            after?: string;
            withCounts?: boolean;
        } = {},
    ): Promise<APIPartialGuild[]> {
        const params = new URLSearchParams();
        if (options.limit !== undefined)
            params.set(
                "limit",
                String(Math.min(200, Math.max(1, options.limit))),
            );
        if (options.before) params.set("before", options.before);
        if (options.after) params.set("after", options.after);
        if (options.withCounts) params.set("with_counts", "true");
        const query = params.toString();
        return this.#rest.get<APIPartialGuild[]>(
            `${Routes.userGuilds()}${query ? `?${query}` : ""}`,
        );
    }

    /** Leaves a guild. */
    public async leaveGuild(guildId: string): Promise<void> {
        await this.#rest.delete(Routes.currentUserGuild(guildId));
    }

    /** Creates a DM channel with a user. */
    public async createDM(userId: string): Promise<APIChannel> {
        return this.#rest.post<APIChannel>("/users/@me/channels", {
            recipient_id: userId,
        });
    }
}
