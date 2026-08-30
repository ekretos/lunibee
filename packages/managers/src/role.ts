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
    const data = await this.#rest.get<any[]>(Routes.guildRoles(this.guildId));
    return data.map((item) => {
      const role = new Role(item);
      this.set(role.id, role);
      return role;
    });
  }

  /** Creates a new role in the guild. */
  public async create(options: RoleCreateOptions): Promise<Role> {
    const { reason, ...payload } = options;
    const data = await this.#rest.post<any>(Routes.guildRoles(this.guildId), {
      ...payload,
      permissions:
        payload.permissions !== undefined
          ? String(payload.permissions)
          : undefined,
    });
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
    );
    const role = new Role(data);
    this.set(role.id, role);
    return role;
  }

  /** Deletes a role from the guild. */
  public async deleteRole(roleId: string): Promise<void> {
    await this.#rest.delete(Routes.guildRole(this.guildId, roleId));
    this.delete(roleId);
  }
}
