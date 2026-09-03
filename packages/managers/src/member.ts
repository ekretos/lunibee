import { REST, Routes } from "@lunibee/rest";
import { GuildMember } from "@lunibee/structures";
import { ResourceManager } from "./base.js";

export interface MemberEditOptions {
    nick?: string | null;
    roles?: string[];
    mute?: boolean;
    deaf?: boolean;
    channel_id?: string | null;
    communication_disabled_until?: string | null;
}

export interface BanOptions {
    reason?: string;
    deleteMessageSeconds?: number;
}

/** Manages Discord guild members. */
export class GuildMemberManager extends ResourceManager<string, GuildMember> {
    readonly #rest: REST;
    public readonly guildId: string;

    public constructor(guildId: string, rest: REST) {
        super(
            (id: string) =>
                rest
                    .get(Routes.guildMember(guildId, id))
                    .then(
                        (data: any) =>
                            new GuildMember({ ...data, guild_id: guildId }),
                    ),
            (member: GuildMember) => member.user.id,
        );
        this.guildId = guildId;
        this.#rest = rest;
    }

    /** Kicks a member from the guild. */
    public async kick(userId: string): Promise<void> {
        await this.#rest.delete(Routes.guildMember(this.guildId, userId));
        this.delete(userId);
    }

    /** Bans a user from the guild. */
    public async ban(userId: string, options: BanOptions = {}): Promise<void> {
        await this.#rest.put(Routes.guildBan(this.guildId, userId), {
            delete_message_seconds: options.deleteMessageSeconds,
        });
        this.delete(userId);
    }

    /** Unbans a user from the guild. */
    public async unban(userId: string): Promise<void> {
        await this.#rest.delete(Routes.guildBan(this.guildId, userId));
    }

    /** Edits a guild member (nickname, roles, timeout, mute, deaf). */
    public async edit(
        userId: string,
        options: MemberEditOptions,
    ): Promise<GuildMember> {
        const data = await this.#rest.patch<
            import("@lunibee/types").APIGuildMember
        >(Routes.guildMember(this.guildId, userId), options);
        const member = new GuildMember({ ...data, guild_id: this.guildId });
        this.set(member.user.id, member);
        return member;
    }

    /** Adds a role to a member. */
    public async addRole(userId: string, roleId: string): Promise<void> {
        await this.#rest.put(
            Routes.guildMemberRole(this.guildId, userId, roleId),
        );
    }

    /** Removes a role from a member. */
    public async removeRole(userId: string, roleId: string): Promise<void> {
        await this.#rest.delete(
            Routes.guildMemberRole(this.guildId, userId, roleId),
        );
    }

    /** Times out a member for a given duration in milliseconds (or clears timeout if null). */
    public async timeout(
        userId: string,
        milliseconds: number | null,
    ): Promise<GuildMember> {
        const timeoutDate =
            milliseconds === null
                ? null
                : new Date(Date.now() + milliseconds).toISOString();
        return this.edit(userId, { communication_disabled_until: timeoutDate });
    }
}
