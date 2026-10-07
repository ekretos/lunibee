import { REST, Routes } from "@lunibee/rest";
import { Role } from "@lunibee/structures";
import type { APIRole } from "@lunibee/types";
import { ResourceManager } from "./base.js";

/** Role fields shared by create and edit. */
interface RoleStyleOptions {
    permissions?: bigint | number | string;
    /** A solid colour as a 24-bit integer. Use `colors` for a gradient. */
    color?: number;
    /** Primary, secondary and tertiary colours: two make a gradient, three the holographic style. */
    colors?: {
        primary: number;
        secondary?: number | null;
        tertiary?: number | null;
    };
    hoist?: boolean;
    mentionable?: boolean;
    /** The role's icon as a data URI (needs the guild's role-icons boost level), or `null` to remove it. */
    icon?: string | null;
    /** A unicode emoji as the role icon, or `null` to remove it. */
    unicodeEmoji?: string | null;
    reason?: string;
}

export interface RoleCreateOptions extends RoleStyleOptions {
    name: string;
}

export interface RoleEditOptions extends RoleStyleOptions {
    name?: string;
    position?: number;
}

/** Manages Discord guild roles. */
export class RoleManager extends ResourceManager<string, Role> {
    readonly #rest: REST;
    public readonly guildId: string;

    public constructor(guildId: string, rest: REST) {
        super(
            (id: string) =>
                rest
                    .get<APIRole>(Routes.guildRole(guildId, id))
                    .then((data) => new Role(data)),
            (role: Role) => role.id,
        );
        this.guildId = guildId;
        this.#rest = rest;
    }

    /** Fetches all roles in the guild. */
    public async fetchAll(): Promise<Role[]> {
        const data = await this.#rest.get<APIRole[]>(
            Routes.guildRoles(this.guildId),
        );
        return data.map((item) => {
            const role = new Role(item);
            this.set(role.id, role);
            return role;
        });
    }

    /** Creates a new role in the guild. */
    public async create(options: RoleCreateOptions): Promise<Role> {
        const { reason, ...payload } = options;
        const data = await this.#rest.post<APIRole>(
            Routes.guildRoles(this.guildId),
            rolePayload(payload),
            { reason },
        );
        return this.#store(data);
    }

    /** Edits an existing role. */
    public async edit(roleId: string, options: RoleEditOptions): Promise<Role> {
        const { reason, ...payload } = options;
        const data = await this.#rest.patch<APIRole>(
            Routes.guildRole(this.guildId, roleId),
            rolePayload(payload),
            { reason },
        );
        return this.#store(data);
    }

    #store(data: APIRole): Role {
        const role = new Role(data);
        this.set(role.id, role);
        return role;
    }

    /** Deletes a role. @param reason Audit-log reason. */
    public async remove(roleId: string, reason?: string): Promise<void> {
        await this.#rest.delete(Routes.guildRole(this.guildId, roleId), {
            reason,
        });
        this.delete(roleId);
    }
    /**
     * Moves roles in the hierarchy. Discord shifts the other roles around them.
     * @param positions Each role's ID and its new position.
     * @param reason Audit-log reason.
     * @returns Every role in the guild, in their new order.
     */
    public async setPositions(
        positions: readonly { id: string; position: number }[],
        reason?: string,
    ): Promise<Role[]> {
        const data = await this.#rest.patch<
            ConstructorParameters<typeof Role>[0][]
        >(
            Routes.guildRoles(this.guildId),
            positions.map(({ id, position }) => ({ id, position })),
            { reason },
        );
        return data.map((item) => {
            const role = new Role(item);
            this.set(role.id, role);
            return role;
        });
    }
}

/** Role options as Discord expects them: `permissions` as a decimal string. */
function rolePayload(options: Omit<RoleEditOptions, "reason">) {
    const { permissions, colors, unicodeEmoji, ...rest } = options;
    return {
        ...rest,
        permissions:
            permissions !== undefined ? String(permissions) : undefined,
        colors: colors && {
            primary_color: colors.primary,
            secondary_color: colors.secondary ?? null,
            tertiary_color: colors.tertiary ?? null,
        },
        unicode_emoji: unicodeEmoji,
    };
}
