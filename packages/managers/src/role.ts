import { REST, Routes } from "@lunibee/rest";
import { Role } from "@lunibee/structures";
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
                    .get(Routes.guildRole(guildId, id))
                    .then((data: any) => new Role(data)),
            (role: Role) => role.id,
        );
        this.guildId = guildId;
        this.#rest = rest;
    }

    /** Fetches all roles in the guild. */
    public async fetchAll(): Promise<Role[]> {
        const data = await this.#rest.get<any[]>(
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
        const data = await this.#rest.post<any>(
            Routes.guildRoles(this.guildId),
            {
                ...payload,
                permissions:
                    payload.permissions !== undefined
                        ? String(payload.permissions)
                        : undefined,
            },
            { reason },
        );
        const role = new Role(data);
        this.set(role.id, role);
        return role;
    }

    /** Edits an existing role. */
    public async edit(roleId: string, options: RoleEditOptions): Promise<Role> {
        const { reason, ...payload } = options;
        const data = await this.#rest.patch<any>(
            Routes.guildRole(this.guildId, roleId),
            {
                ...payload,
                permissions:
                    payload.permissions !== undefined
                        ? String(payload.permissions)
                        : undefined,
            },
            { reason },
        );
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
    /** @deprecated Use {@link RoleManager.remove}, which also takes an audit-log reason. Removed in 0.3.0. */
    public deleteRole(roleId: string): Promise<void> {
        return this.remove(roleId);
    }
}
