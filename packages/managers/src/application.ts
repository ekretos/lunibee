import { REST, Routes } from "@lunibee/rest";
import type {
  APIApplicationCommand,
  ApplicationCommandData,
} from "@lunibee/types";

/** Manages global and guild-scoped application commands for a Discord application. */
export class ApplicationCommandManager {
  readonly #rest: REST;
  readonly #applicationId: string;

  /** Creates an application command manager. @param rest REST transport. @param applicationId Application identifier. */
  public constructor(rest: REST, applicationId: string) {
    this.#rest = rest;
    this.#applicationId = applicationId;
  }

  // ──────────────────── Global commands ────────────────────

  /** Fetches all global application commands. @returns Array of registered commands. */
  public fetch(): Promise<APIApplicationCommand[]> {
    return this.#rest.get<APIApplicationCommand[]>(
      Routes.applicationCommands(this.#applicationId),
    );
  }

  /** Creates a single global application command. @param data Command data. @returns Created command. */
  public create(data: ApplicationCommandData): Promise<APIApplicationCommand> {
    return this.#rest.post<APIApplicationCommand>(
      Routes.applicationCommands(this.#applicationId),
      data,
    );
  }

  /** Overwrites all global application commands atomically. @param commands Array of command data. @returns New full command list. */
  public set(
    commands: ApplicationCommandData[],
  ): Promise<APIApplicationCommand[]> {
    return this.#rest.put<APIApplicationCommand[]>(
      Routes.applicationCommands(this.#applicationId),
      commands,
    );
  }

  /** Edits a global application command. @param commandId Command identifier. @param data Partial command data. @returns Updated command. */
  public edit(
    commandId: string,
    data: Partial<ApplicationCommandData>,
  ): Promise<APIApplicationCommand> {
    return this.#rest.patch<APIApplicationCommand>(
      Routes.applicationCommand(this.#applicationId, commandId),
      data,
    );
  }

  /** Deletes a global application command. @param commandId Command identifier. @returns Nothing. */
  public async delete(commandId: string): Promise<void> {
    await this.#rest.delete(
      Routes.applicationCommand(this.#applicationId, commandId),
    );
  }

  // ──────────────────── Guild-scoped commands ────────────────────

  /** Fetches all guild-scoped application commands. @param guildId Guild identifier. @returns Array of registered guild commands. */
  public fetchGuild(guildId: string): Promise<APIApplicationCommand[]> {
    return this.#rest.get<APIApplicationCommand[]>(
      Routes.guildApplicationCommands(this.#applicationId, guildId),
    );
  }

  /** Creates a single guild-scoped application command. @param guildId Guild identifier. @param data Command data. @returns Created command. */
  public createGuild(
    guildId: string,
    data: ApplicationCommandData,
  ): Promise<APIApplicationCommand> {
    return this.#rest.post<APIApplicationCommand>(
      Routes.guildApplicationCommands(this.#applicationId, guildId),
      data,
    );
  }

  /** Overwrites all guild-scoped application commands atomically. @param guildId Guild identifier. @param commands Array of command data. @returns New full command list. */
  public setGuild(
    guildId: string,
    commands: ApplicationCommandData[],
  ): Promise<APIApplicationCommand[]> {
    return this.#rest.put<APIApplicationCommand[]>(
      Routes.guildApplicationCommands(this.#applicationId, guildId),
      commands,
    );
  }

  /** Edits a guild-scoped application command. @param guildId Guild identifier. @param commandId Command identifier. @param data Partial command data. @returns Updated command. */
  public editGuild(
    guildId: string,
    commandId: string,
    data: Partial<ApplicationCommandData>,
  ): Promise<APIApplicationCommand> {
    return this.#rest.patch<APIApplicationCommand>(
      Routes.guildApplicationCommand(this.#applicationId, guildId, commandId),
      data,
    );
  }

  /** Deletes a guild-scoped application command. @param guildId Guild identifier. @param commandId Command identifier. @returns Nothing. */
  public async deleteGuild(guildId: string, commandId: string): Promise<void> {
    await this.#rest.delete(
      Routes.guildApplicationCommand(this.#applicationId, guildId, commandId),
    );
  }
}
