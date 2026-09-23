# @lunibee/managers

> Cached, REST-backed managers for users, guilds, channels, messages, members and more.

```bash
bun add @lunibee/managers
```

Most applications use these through a `Client` (`client.guilds`, `client.channels`, …):

```ts
import { REST } from "@lunibee/rest";
import { GuildManager, ChannelManager } from "@lunibee/managers";

const rest = new REST({ token: process.env.DISCORD_TOKEN! });
const guilds = new GuildManager(rest);
const channels = new ChannelManager(rest);

const guild = await guilds.fetch("123456789012345678");
await guilds.bans(guild.id).create("223456789012345678", {
    deleteMessageSeconds: 3600,
    reason: "Spam",
});
await channels.permissionOverwrites("323456789012345678").edit("423456789012345678", {
    type: 0,
    allow: 1024n,
});
const page = await channels.fetchPage("323456789012345678", { limit: 50 });
console.log(page.messages.length, page.hasMore);
```

## Managers

| Manager | Access through a client |
|---|---|
| `UserManager` | `client.users` |
| `GuildManager` | `client.guilds` (`fetchAuditLog`, `fetchMembers`, automod rules, …) |
| `ChannelManager` / `MessageManager` / `ThreadManager` | `client.channels`, `client.channels.messages(id)`, `client.channels.threads(id)` |
| `GuildMemberManager`, `RoleManager`, `EmojiManager` | per guild |
| `GuildBanManager` | `client.guilds.bans(guildId)` |
| `GuildScheduledEventManager` | `client.guilds.scheduledEvents(guildId)` |
| `PermissionOverwriteManager` | `client.channels.permissionOverwrites(channelId)` |
| `StageInstanceManager` | `client.stageInstances` |
| `ApplicationCommandManager` | `client.application.commands` (`set`, `create`, `setGuild`, …) |

`Manager` and `ResourceManager` are the base classes; `CachedManager` is an alias of
`ResourceManager`.

Docs: https://lunibee.js.org/packages/managers/
