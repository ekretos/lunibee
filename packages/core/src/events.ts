import type { ClientEvents } from "./index.js";

/** Names of events emitted by a Lunibee client. */
export enum ClientEvent {
  Ready = "ready",
  Raw = "raw",
  Error = "error",
  Open = "open",
  Close = "close",
  MessageCreate = "messageCreate",
  MessageUpdate = "messageUpdate",
  MessageDelete = "messageDelete",
  MessageDeleteBulk = "messageDeleteBulk",
  GuildCreate = "guildCreate",
  GuildUpdate = "guildUpdate",
  GuildDelete = "guildDelete",
  ChannelCreate = "channelCreate",
  ChannelUpdate = "channelUpdate",
  ChannelDelete = "channelDelete",
  ThreadCreate = "threadCreate",
  ThreadUpdate = "threadUpdate",
  ThreadDelete = "threadDelete",
  GuildMemberAdd = "guildMemberAdd",
  GuildMemberUpdate = "guildMemberUpdate",
  GuildMemberRemove = "guildMemberRemove",
  MessageReactionAdd = "messageReactionAdd",
  MessageReactionRemove = "messageReactionRemove",
  MessageReactionRemoveAll = "messageReactionRemoveAll",
  InteractionCreate = "interactionCreate",
  GuildRoleCreate = "guildRoleCreate",
  GuildRoleUpdate = "guildRoleUpdate",
  GuildRoleDelete = "guildRoleDelete",
  GuildBanAdd = "guildBanAdd",
  GuildBanRemove = "guildBanRemove",
  GuildEmojisUpdate = "guildEmojisUpdate",
}

/** Names of events emitted by a Lunibee client. */
export type ClientEventName = keyof ClientEvents;

/** Listener signature for a Lunibee client event. */
export type ClientListener<K extends ClientEventName> = (
  ...args: ClientEvents[K]
) => unknown;
