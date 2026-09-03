import { ResourceManager } from "./base.js";
import { User } from "@lunibee/structures";
import { type REST, Routes } from "@lunibee/rest";
import type { APIChannel } from "@lunibee/types";

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

    /** Leaves a guild. */
    public async leaveGuild(guildId: string): Promise<void> {
        await this.#rest.delete(`/users/@me/guilds/${guildId}`);
    }

    /** Creates a DM channel with a user. */
    public async createDM(userId: string): Promise<APIChannel> {
        return this.#rest.post<APIChannel>("/users/@me/channels", {
            recipient_id: userId,
        });
    }
}
