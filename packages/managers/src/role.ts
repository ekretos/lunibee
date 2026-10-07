import { REST, Routes } from "@lunibee/rest";
import { Role } from "@lunibee/structures";
import type { APIRole } from "@lunibee/types";
import { ResourceManager } from "./base.js";

export interface RoleCreateOptions {
    name: string;
    permissions?: bigint | number | string;
    color?: number;
    hoist?: boolean;
    mentionable?: boolean;
    reason?: string;
}

export interface RoleEditOptions {
    name?: string;
    permissions?: bigint | number | string;
    color?: number;
    hoist?: boolean;
    mentionable?: boolean;
    position?: number;
    reason?: string;
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
    const { permissions, ...rest } = options;
    return {
        ...rest,
        permissions:
            permissions !== undefined ? String(permissions) : undefined,
    };
}
