/** Gateway intent bit flags supported by Discord (PascalCase). */
export const GatewayIntentBits = {
  Guilds: 1 << 0,
  GuildMembers: 1 << 1,
  GuildModeration: 1 << 2,
  GuildExpressions: 1 << 3,
  GuildIntegrations: 1 << 4,
  GuildWebhooks: 1 << 5,
  GuildInvites: 1 << 6,
  GuildVoiceStates: 1 << 7,
  GuildPresences: 1 << 8,
  GuildMessages: 1 << 9,
  GuildMessageReactions: 1 << 10,
  GuildMessageTyping: 1 << 11,
  DirectMessages: 1 << 12,
  DirectMessageReactions: 1 << 13,
  DirectMessageTyping: 1 << 14,
  MessageContent: 1 << 15,
  GuildScheduledEvents: 1 << 16,
  AutoModerationConfiguration: 1 << 20,
  AutoModerationExecution: 1 << 21,
  GuildMessagePolls: 1 << 24,
  DirectMessagePolls: 1 << 25,
} as const;

/** Idiomatic camelCase Gateway intent bit flags supported by Discord. */
export const IntentBits = {
  guild: 1 << 0,
  guilds: 1 << 0,
  guildMembers: 1 << 1,
  guildModeration: 1 << 2,
  guildBans: 1 << 2,
  guildExpressions: 1 << 3,
  guildEmojis: 1 << 3,
  guildEmojisAndStickers: 1 << 3,
  guildIntegrations: 1 << 4,
  guildWebhooks: 1 << 5,
  guildInvites: 1 << 6,
  guildVoiceStates: 1 << 7,
  guildPresences: 1 << 8,
  guildMessages: 1 << 9,
  guildMessage: 1 << 9,
  guildMessageReactions: 1 << 10,
  guildMessageTyping: 1 << 11,
  directMessages: 1 << 12,
  directMessageReactions: 1 << 13,
  directMessageTyping: 1 << 14,
  messageContent: 1 << 15,
  guildScheduledEvents: 1 << 16,
  autoModerationConfiguration: 1 << 20,
  autoModerationExecution: 1 << 21,
  guildMessagePolls: 1 << 24,
  directMessagePolls: 1 << 25,
} as const;

/** Alias for IntentBits. */
export const Intents = IntentBits;

/** Gateway intent resolvable value (single bitfield, enum key, or array of bitfields/strings). */
export type GatewayIntentResolvable =
  | number
  | keyof typeof GatewayIntentBits
  | keyof typeof IntentBits
  | (number | keyof typeof GatewayIntentBits | keyof typeof IntentBits | string)[];

/** Resolves any GatewayIntentResolvable into a raw bitfield integer. */
export function resolveGatewayIntents(intents: GatewayIntentResolvable): number {
  if (typeof intents === "number") return intents;
  if (Array.isArray(intents)) {
    return intents.reduce<number>((acc, intent) => {
      return acc | resolveGatewayIntents(intent as any);
    }, 0);
  }
  if (typeof intents === "string") {
    if (intents in GatewayIntentBits) return (GatewayIntentBits as Record<string, number>)[intents]!;
    if (intents in IntentBits) return (IntentBits as Record<string, number>)[intents]!;
    const lower = intents.charAt(0).toLowerCase() + intents.slice(1);
    if (lower in IntentBits) return (IntentBits as Record<string, number>)[lower]!;
    const num = Number(intents);
    if (!Number.isNaN(num)) return num;
  }
  return 0;
}
