export * from "@lunibee/core";
export * from "@lunibee/builders";
export * from "@lunibee/collection";
export * from "@lunibee/formatters";
export * from "@lunibee/handlers";
export * from "@lunibee/managers";
export * from "@lunibee/rest";
export * from "@lunibee/sharding";
export * from "@lunibee/structures";
export * from "@lunibee/types";
export * from "@lunibee/utils";
export * from "@lunibee/voice";
export * from "@lunibee/ws";

// Explicit re-exports for TypeScript consumer clarity
export {
  CommandInteraction,
  ComponentInteraction,
  ModalSubmitInteraction,
  AutocompleteInteraction,
  Interaction,
  GuildMember,
  Role,
  TextChannel,
  Message,
} from "@lunibee/structures";

export {
  EmbedBuilder,
  SlashCommandBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectBuilder,
  EntitySelectBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ActionRowBuilder,
  AttachmentBuilder,
  ApplicationCommandOptionType,
} from "@lunibee/builders";

export { Gateway } from "@lunibee/ws";
export type { GatewayOptions } from "@lunibee/ws";
export { Collection, Cache } from "@lunibee/collection";

export {
  REST,
  RESTError,
  Routes,
  WebhookClient,
  type WebhookClientOptions,
  type WebhookMessageOptions,
} from "@lunibee/rest";
