import { REST, Routes } from "@lunibee/rest";
import { GuildMember, type ResourceContext } from "@lunibee/structures";
import { ResourceManager, splitReason } from "./base.js";
import type { APIGuildMember } from "@lunibee/types";

export interface MemberEditOptions {
    /** Audit-log reason. */
    reason?: string;
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
    readonly #context: () => ResourceContext | undefined;
    public readonly guildId: string;

    /** @param context Gives fetched members their actions (`member.kick()`...). */
    public constructor(
        guildId: string,
        rest: REST,
        context: () => ResourceContext | undefined = () => undefined,
    ) {
        super(
            (id: string) =>
                rest
                    .get<APIGuildMember>(Routes.guildMember(guildId, id))
                    .then(
                        (data) =>
                            new GuildMember(
                                { ...data, guild_id: guildId },
                                context(),
                            ),
                    ),
            (member: GuildMember) => member.user.id,
        );
        this.guildId = guildId;
        this.#rest = rest;
        this.#context = context;
    }

    /** Kicks a member from the guild. @param reason Audit-log reason. */
    public async kick(userId: string, reason?: string): Promise<void> {
        await this.#rest.delete(Routes.guildMember(this.guildId, userId), {
            reason,
        });
        this.delete(userId);
    }

    /** Bans a user from the guild. */
    public async ban(userId: string, options: BanOptions = {}): Promise<void> {
        await this.#rest.put(
            Routes.guildBan(this.guildId, userId),
            { delete_message_seconds: options.deleteMessageSeconds },
            { reason: options.reason },
        );
        this.delete(userId);
    }

    /** Unbans a user from the guild. @param reason Audit-log reason. */
    public async unban(userId: string, reason?: string): Promise<void> {
        await this.#rest.delete(Routes.guildBan(this.guildId, userId), {
            reason,
        });
    }

    /** Edits a guild member (nickname, roles, timeout, mute, deaf). Put the audit-log reason in `options.reason`. @param reason Deprecated: use `options.reason`. Removed in 0.3.0. */
    public async edit(
        userId: string,
        options: MemberEditOptions,
        reason?: string,
    ): Promise<GuildMember> {
        const [payload, optionsReason] = splitReason(options);
        const data = await this.#rest.patch<
            import("@lunibee/types").APIGuildMember
        >(Routes.guildMember(this.guildId, userId), payload, {
            reason: optionsReason ?? reason,
        });
        const member = new GuildMember(
            { ...data, guild_id: this.guildId },
            this.#context(),
        );
        this.set(member.user.id, member);
        return member;
    }

    /** Adds a role to a member. @param reason Audit-log reason. */
    public async addRole(
        userId: string,
        roleId: string,
        reason?: string,
    ): Promise<void> {
        await this.#rest.put(
            Routes.guildMemberRole(this.guildId, userId, roleId),
            undefined,
            { reason },
        );
    }

    /** Removes a role from a member. @param reason Audit-log reason. */
    public async removeRole(
        userId: string,
        roleId: string,
        reason?: string,
    ): Promise<void> {
        await this.#rest.delete(
            Routes.guildMemberRole(this.guildId, userId, roleId),
            { reason },
        );
    }

    /** Times out a member for a given duration in milliseconds (or clears timeout if null). @param reason Audit-log reason. */
    public async timeout(
        userId: string,
        milliseconds: number | null,
        reason?: string,
    ): Promise<GuildMember> {
        const timeoutDate =
            milliseconds === null
                ? null
                : new Date(Date.now() + milliseconds).toISOString();
        return this.edit(
            userId,
            { communication_disabled_until: timeoutDate },
            reason,
        );
    }
}
