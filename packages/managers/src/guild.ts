import { ResourceManager } from "./base.js";
import { Guild } from "@lunibee/structures";
import { type REST, Routes } from "@lunibee/rest";
import type { APIChannel, APIWebhook } from "@lunibee/types";

type GuildData = ConstructorParameters<typeof Guild>[0];

export interface GuildCreateOptions extends Record<string, unknown> {
  name: string;
}
export interface GuildEditOptions extends Record<string, unknown> {}

export class GuildManager extends ResourceManager<string, Guild> {
  readonly #rest: REST;
  public constructor(rest: REST) {
    super(
      async (id) => new Guild(await rest.get<GuildData>(Routes.guild(id))),
      (guild) => guild.id,
    );
    this.#rest = rest;
  }

  /** Creates a new guild. (Bot must be in fewer than 10 guilds). */
  public async create(options: GuildCreateOptions): Promise<Guild> {
    const data = await this.#rest.post<GuildData>("/guilds", options);
    return this.upsert(new Guild(data));
  }

  /** Modifies a guild's settings. */
  public async edit(id: string, options: GuildEditOptions): Promise<Guild> {
    const data = await this.#rest.patch<GuildData>(Routes.guild(id), options);
    return this.upsert(new Guild(data));
  }

  /** Deletes a guild permanently. User must be the owner. */
  public async deleteGuild(id: string): Promise<void> {
    await this.#rest.delete(Routes.guild(id));
  }

  /** Fetches a guild's preview (even if the bot is not in the guild). */
  public async fetchPreview(id: string): Promise<unknown> {
    return this.#rest.get(`${Routes.guild(id)}/preview`);
  }

  /** Fetches all active threads in the guild. */
  public async fetchActiveThreads(id: string): Promise<unknown> {
    return this.#rest.get(`${Routes.guild(id)}/threads/active`);
  }

  /** Fetches all webhooks in the guild. */
  public async fetchWebhooks(id: string): Promise<unknown> {
    return this.#rest.get(`${Routes.guild(id)}/webhooks`);
  }

  /** Fetches all invites in the guild. */
  public async fetchInvites(id: string): Promise<unknown> {
    return this.#rest.get(`${Routes.guild(id)}/invites`);
  }
}
