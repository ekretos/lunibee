# Discord.js → Lunibee Compatibility Matrix

> Master map. **Status legend:** ✅ Preserve (already matches) · 🔀 Alias (name differs,
> add re-export) · 🔧 Adapt (signature differs, add compatible overload) · 🏗 Implement
> (missing) · ⚑ Intentionally-different (document, don't force). Buckets defined in
> `api-conventions.md §1`. "Owner" = Phase-1 agent who acts on it.

## Client & lifecycle  (owner: Rohan · `core`, `lunibee`)

| Discord.js | Lunibee | Status | Notes |
|---|---|---|---|
| `new Client({ intents })` | `new Client(options)` | ✅ | `intents`, `token`, `rest`, `gateway` in options. |
| `Client extends EventEmitter` (Node) | custom minimal EE | ⚑ | `on/once/off/removeAllListeners` only; `emit` is protected. No Node-EE extras. |
| `client.login(token)` | `login(token?)` → `Promise<string>` | ✅ | Returns token used. |
| `client.destroy()` | `destroy()` | ✅ | |
| `client.isReady()` / `readyAt` / `uptime` / `ws.ping` | same | ✅ | `client.ping` == gateway ping. |
| `client.user` | `user?: ClientUser` | ✅ | |
| `client.users/guilds/channels` | same managers | ✅ | |
| `client.application.commands` | same | ✅ | `ApplicationCommandManager`. |
| `client.ws` (WebSocketManager) | `client.ws` / `client.gateway` → `Gateway` | 🔧 | Same object under both names; shape differs from djs WSManager. |
| `Events` enum | `ClientEvent` enum | 🔀 | Add `export { ClientEvent as Events }` if wanted. |
| `client.token` setter via login | `rest.setToken` + options | ✅ | |
| `GatewayIntentBits` | same | ✅ | In `types`. |
| `IntentsBitField` | `Intents` / `IntentBits` / `resolveGatewayIntents` | 🔀 | Alias `IntentsBitField → Intents`. |

## Events  (owner: Rohan)

All Discord.js gateway events are emitted with **matching camelCase names** (`ready`,
`messageCreate`, `messageUpdate`, `messageDelete(+Bulk)`, `messageReaction*`,
`messagePollVote*`, `guild*`, `guildMember*`, `guildBan*`, `guildRole*`, `guildEmojis/
StickersUpdate`, `guildScheduledEvent*`, `autoModeration*`, `channel*`, `thread*`,
`stageInstance*`, `invite*`, `webhooksUpdate`, `voice*Update`, `presenceUpdate`,
`typingStart`, `interactionCreate`, `raw`, `error`). **Status ✅.** Divergence: several
handlers emit **raw `API*` payloads** rather than wrapped structures (e.g. `guildMemberAdd`
→ `APIGuildMember`, `messageDelete` → `APIMessageDeleteEvent`). See gaps doc — 🔧 candidates
for wrapping. `guildAvailable` is typed but not emitted anywhere — 🏗.

## Interactions  (owner: Rohan/Dev · `structures`)

| Discord.js | Lunibee | Status |
|---|---|---|
| `CommandInteraction` / `ButtonInteraction`/`SelectMenuInteraction` / `ModalSubmitInteraction` / `AutocompleteInteraction` | `CommandInteraction` / `ComponentInteraction` / `ModalSubmitInteraction` / `AutocompleteInteraction` | 🔧 | djs splits component subtypes; Lunibee has one `ComponentInteraction`. Alias/guards optional. |
| `isChatInputCommand/isButton/isModalSubmit/isAutocomplete/isMessageComponent` | `isChatInputCommand/isMessageComponent/isModalSubmit/isAutocomplete` | 🔧 | Missing `isButton/isStringSelectMenu/isAnySelectMenu` — 🏗 thin guards. |
| `interaction.options.getString/Integer/Number/Boolean/User/Channel/Role/Mentionable/Attachment/getSubcommand(Group)` | same on `CommandOptions` | ✅ | |
| `reply/deferReply/editReply/deleteReply/followUp/update/deferUpdate/showModal` | same | ✅ | |
| `commandName / customId / values / guildId / channelId / replied / deferred` | same | ✅ | |
| `getFocused()` (autocomplete) | `respond()` present; `getFocused` | 🏗 | verify presence. |

## Structures  (owner: Dev · `structures`)

| Discord.js | Lunibee | Status |
|---|---|---|
| `Base` (`id`,`createdAt`,`createdTimestamp`) | `BaseStructure` (`id`,`createdAt`,`toString`) | 🔧 | Add `createdTimestamp` getter centrally. |
| `Message` (+`edit/delete/reply/react/pin/crosspost/...`) | `Message` same methods | ✅ | Rich, djs-parity. |
| `User` (`avatarURL/displayName/...`) | `User` same | ✅ | |
| `Guild` (`iconURL/bannerURL/features/...`) | `Guild` same | ✅ | |
| `BaseChannel`/`TextChannel`/`ThreadChannel`/... | `Channel` / `TextChannel` | 🔧 | Fewer channel subclasses; single `Channel` base. |
| `GuildMember`/`Role`/`Invite`/`Webhook`/`Emoji`/`AutoModerationRule` | present | ✅ | |
| Welcome screen / onboarding | `GuildWelcomeScreen`/`GuildOnboarding`/`OnboardingPrompt*` | ✅ | |
| `Embed` (data) | `Embed` | ✅ | Builder is separate (`EmbedBuilder`). |
| `AuditLog`/`AuditLogEntry` | present | ✅ | |
| `Presence`/`VoiceState`/`StageInstance` as structures | raw `API*` in events | ⚑/🏗 | currently raw payloads. |

## Managers  (owner: Dev · `managers`)

`UserManager`, `GuildManager`, `ChannelManager`, `MessageManager`, `ThreadManager`,
`RoleManager`, `GuildMemberManager`, `EmojiManager`, `ApplicationCommandManager` — names
match Discord.js. **Status ✅.** Methods: `fetch/resolve/create/edit/delete/send/...`;
message paging (`fetchPage`), `bulkDelete` (2–100 guard), reactions, pins — djs-parity.
Gaps: no `GuildBanManager`/`GuildScheduledEventManager`/`StageInstanceManager`/
`PermissionOverwriteManager` classes (🏗, lower priority). Cache base is `Manager`/
`ResourceManager` (djs `CachedManager`) — 🔧 name-only.

## Builders  (owner: Dev · `builders`)

| Discord.js | Lunibee | Status |
|---|---|---|
| `EmbedBuilder` | `EmbedBuilder` | ✅ |
| `ButtonBuilder`+`ButtonStyle` | same | ✅ |
| `ActionRowBuilder` | same | ✅ |
| `StringSelectMenuBuilder` | `StringSelectBuilder` | 🔀 | alias `StringSelectMenuBuilder`. |
| `UserSelectMenuBuilder`/`RoleSelectMenuBuilder`/`ChannelSelectMenuBuilder`/`MentionableSelectMenuBuilder` | `EntitySelectBuilder` (unified) | 🔧 | djs splits per entity type; provide typed aliases or `setType`. |
| `ModalBuilder`+`TextInputBuilder`+`TextInputStyle` | same | ✅ |
| `SlashCommandBuilder` (`addStringOption(o=>…)`, `setName/setDescription/setDefaultMemberPermissions/setDMPermission/setNSFW`) | same (`setNSFW`+`setNsfw`) | ✅ |
| `ContextMenuCommandBuilder` | `UserCommandBuilder` / `MessageCommandBuilder` | 🔧 | djs uses one builder + `setType`. |
| `AttachmentBuilder` | same | ✅ |
| Components V2 builders | `ContainerBuilder`/`SectionBuilder`/`TextDisplayBuilder`/`MediaGalleryBuilder`/`FileComponentBuilder`/`SeparatorBuilder`/`ThumbnailBuilder` | ✅ | present; verify JSON parity. |

## REST  (owner: Aditya · `rest`)

| Discord.js (`@discordjs/rest`) | Lunibee | Status |
|---|---|---|
| `new REST().setToken()` | `new REST({token})` / `setToken()` | ✅ |
| `rest.get/post/patch/put/delete(path, { body })` | `get/post/patch/put/delete(path, body)` | ⚑ | positional body is Lunibee-canonical; add `{body}` overload only additively. |
| `rest.request(options)` | `request(...)` | 🔧 | verify options shape. |
| `Routes` | `Routes` map | ✅ | broad coverage. |
| `DiscordAPIError` | `RESTError` | 🔀 | alias. |
| rate-limit handling / retries | retry policy + redis/store buckets | ✅ | |
| `WebhookClient` | `WebhookClient` | ✅ | in rest. |

## Gateway  (owner: Vikram · `ws`)

| Discord.js | Lunibee | Status |
|---|---|---|
| `WebSocketManager`/`WebSocketShard` | `Gateway` (single) | ⚑ | one-connection model; `client.ws`/`client.gateway`. |
| opcodes/close-codes/`Status` | `GatewayOpcodes`/`GatewayState` | 🔧 | name map. |
| `shard.ping` / reconnect / resume | `ping` + connect/close lifecycle | ✅ | reconnect/resume behaviour to be verified by Vikram. |
| `setPresence/requestGuildMembers/setVoiceState` | same on Gateway (+ proxied on Client) | ✅ | |

## Voice  (owner: Neha · `voice`)

| Discord.js (`@discordjs/voice`) | Lunibee | Status |
|---|---|---|
| `joinVoiceChannel()` (factory) | `new VoiceConnection(options)` | 🔧 | add factory wrapper. |
| `createAudioPlayer()` | `new AudioPlayer()` | 🔧 | factory wrapper. |
| `createAudioResource()` | `AudioStream` | 🔧 | map concept. |
| `AudioPlayer`/`VoiceConnection`/`VoiceConnectionStatus` | `AudioPlayer`/`VoiceConnection`/`VoiceConnectionState` | 🔧 | enum name. |
| `entersState()`/`getVoiceConnection()` | — | 🏗 | helpers missing. |

## Sharding  (owner: Neha · `sharding`)

| Discord.js | Lunibee | Status |
|---|---|---|
| `ShardingManager` | `ShardManager` | 🔀 | alias `ShardingManager`. |
| `Shard` | shard info in `ShardManager`/`ClusterManager` | 🔧 | |
| cross-shard broadcast/eval | `ShardBus` / `ClusterManager` | 🔧 | map `broadcastEval` concept. |

## Types & enums  (owner: **Arjun** · `types` — coordination zone)

`API*` payload types mirror `discord-api-types` (`APIMessage`, `APIGuild`, `APIChannel`,
`APIEmbed`, `APIApplicationCommand`, event payloads, …). Enums present: `GatewayIntentBits`,
`ChannelType`, `ApplicationCommandType/OptionType`, `MessageFlags`, `StickerType/FormatType`,
`VerificationLevel`, `PremiumTier`, `PermissionFlagsBits`, `PermissionOverwriteType`.
**Status ✅ mostly; any additions/renumbering here MUST route through Arjun.** Discord.js
re-exports discord-api-types under the same names — alias gaps handled here, not per-package.

## Collection / utilities

`Collection extends Map` (djs `Collection`) ✅ · `Cache` ⚑ (Lunibee extra) · formatters/
handlers/utils map to `@discordjs/formatters` and misc helpers (spot-check names, low pri).
