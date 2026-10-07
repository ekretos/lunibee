# Lunibee 0.3 workflow: design

Status: **decided; steps 1 (handles) and 2 (channel kinds) are built.** Step 0b of `.roadmap/0.3.0.md`. Agree the names here,
then build in the order at the end.

## Why

Today a bot reads like discord.js: `client.guilds.cache.get(id)`,
`guild.members.fetch(id)`, `new SlashCommandBuilder()`, `interaction.options.getUser("user")`.
Lunibee 0.3 keeps the same engine (managers, caches, REST) but changes how you reach it:

1. **Handles.** You name a thing by its ids and get a small object that knows how to
   read it and act on it. No manager graph to walk.
2. **One read rule everywhere:** `peek()` = cache only, `get()` = cache then Discord,
   `fetch()` = Discord now.
3. **A chained REST client** next to the typed methods, with paging built in.
4. **Channels by kind**, a short string instead of a number, narrowing the type.
5. **A command is one object**: options declared once, typed in the handler, usable as a
   slash command, a prefix command, or both.

The old API stays as `@deprecated` aliases until 0.4.0. `lunibee migrate` rewrites calls
it can; the Upgrading page lists the rest.

## 1. Handles and the read rule

```ts
// before
const guild = await client.guilds.fetch(id);
const member = await client.guilds.members(id).fetch(userId);
const channel = await client.channels.fetch(channelId);
await client.guilds.members(id).kick(userId, "spam");
await channel.send("hi");

// after
const member = await bot.member(guildId, userId).get();   // cache, else Discord
bot.member(guildId, userId).peek();                        // cache only, or undefined
await bot.member(guildId, userId).fetch();                 // Discord, refreshes the cache
await bot.member(guildId, userId).kick("spam");
await bot.channel(channelId).send("hi");
await bot.guild(guildId).member(userId).timeout("10m", "spam");
```

- Entry points: `bot.guild(id)`, `bot.channel(id)`, `bot.person(id)`, `bot.member(guildId, userId)`,
  `bot.role(guildId, roleId)`, `bot.message(channelId, messageId)`. A user is `bot.person(id)`
  because `bot.user` is already the bot's own account.
- A handle holds ids only. It is cheap, can be created before the thing is cached, and
  never throws until you use it.
- Every handle has `peek()`, `get()`, `fetch()`; actions that Discord offers on that
  thing (`kick`, `ban`, `timeout`, `send`, `delete`, `edit`) sit on the handle.
- `get()` and `fetch()` share one request when called together for the same id, and a
  cached value is never replaced by an older fetch.
- `bot.guild(id).members` and `.channels` give the cached collections for scans
  (`bot.guild(id).members.find(...)`); the collection is the same `Collection`.
- Durations accept `"10m"`, `"2h"`, `90_000`.

## 2. REST: chained and paged

```ts
// before
await client.rest.get(Routes.guildMembers(guildId), { query: { limit: 1000 } });
await client.rest.patch(Routes.guildMember(guildId, userId), { nick: "x" }, { reason: "r" });

// after
await bot.api.guilds(guildId).members(userId).patch({ nick: "x" }, { reason: "r" });
await bot.api.channels(channelId).messages.post({ content: "hi" });
for await (const member of bot.api.guilds(guildId).members.pages({ limit: 1000 })) { /* … */ }
const all = await bot.api.guilds(guildId).members.all({ max: 5_000 });
```

- `bot.api` is a typed path builder over the same `REST`: segments are the Discord
  route words, a call with an id descends, `.get/.post/.put/.patch/.delete` send.
- `{ reason }` is the audit-log reason; `{ signal }` cancels.
- `.pages()` is an async iterator and `.all({ max })` collects, following `after`,
  `before` or the `limit` cursor the route uses. Rate limits and retries are the existing
  REST ones.
- `bot.rest` and `Routes` stay for anything the builder does not cover.

## 3. Channels by kind

```ts
const channel = await bot.channel(id).get();
if (channel.is("text")) await channel.send("hi");          // narrowed to TextChannel
switch (channel.kind) {
  case "text": case "announcement": case "voice": case "stage":
  case "category": case "thread": case "forum": case "media": case "dm": case "group-dm":
}
const voice = await bot.channel(id).as("voice");            // throws a clear error if it is not
```

- `kind` is a string literal on every channel, replacing `type === 0`.
- `is(kind)` narrows; `as(kind)` asserts.
- `ChannelEnum` stays for the raw numbers in payloads.
- Creating: `bot.guild(id).createChannel({ kind: "text", name: "general", parent: categoryId })`
  with the options each kind accepts (bitrate for voice, tags for forum, …).

## 4. Commands: one object

```ts
import { command, option } from "lunibee";

export default command({
  name: "timeout",
  description: "Time a member out",
  permissions: ["ModerateMembers"],
  options: {
    user: option.user({ required: true }),
    minutes: option.integer({ min: 1, max: 40_320, default: 10 }),
    reason: option.string({ max: 500 }),
    where: option.channel({ kinds: ["text", "announcement"] }),
  },
  prefix: true,                       // also answer "!timeout @user 10 spam"
  async run({ bot, options, reply }) {
    // options.user: string (id)  · options.minutes: number  · options.reason?: string
    await bot.member(guildId, options.user).timeout(`${options.minutes}m`, options.reason);
    await reply(`Timed out <@${options.user}>.`);
  },
});
```

- Options are an object: the key is the option name, the value says the type. The handler
  receives them typed (required and `default` make a value non-optional).
- `option.user | channel | role | mentionable | string | integer | number | boolean |
  attachment | choice`; channel options take `kinds`, string and number options take
  `choices`, `min`, `max`, `autocomplete`.
- `prefix: true` (or `{ aliases: ["mute"] }`) parses the same options from a message
  with the existing `parsePrefixArgs`; a missing or invalid argument replies with the
  usage line.
- `reply` works for both: an interaction reply for slash, a message reply for prefix.
- `bot.commands.deploy()` registers the slash definitions; `bot.commands.listen({ prefix: "!" })`
  routes both kinds. The CLI loads `src/commands/**` the way it loads handlers.

## 5. CLI

```sh
lunibee create command timeout            # slash command (default)
lunibee create command timeout --prefix   # prefix command only
lunibee create command timeout --both     # one file, both
lunibee create command timeout --slash --description "Time a member out" --category moderation
lunibee sync commands                     # regenerate src/commands/index.ts, like sync handlers
```

Flags: `--slash`, `--prefix`, `--both` (exclusive; slash by default), plus the existing
`--description`, `--category`, `--force`, `--dry-run`.

## Build order

1. `bot.guild/channel/user/member/role/message` handles with `peek/get/fetch` and the
   actions that exist today; collections on `bot.guild(id)`.
2. Channel `kind`, `is()`, `as()`, kind-aware `createChannel`.
3. `option.*` and `command()`; slash path first, then `prefix`; `bot.commands`.
4. `bot.api` path builder with `pages()` / `all()`.
5. CLI: `create command --slash/--prefix/--both`, `sync commands`; templates for the new `command()`.
6. `lunibee migrate` rewrites; docs, Quick Start, recipes and examples move to the new
   workflow; Upgrading page and changelog.

Each step ships with tests and keeps the old API working.

## Decisions

- The entry object stays `new Client(...)`; examples call the instance `bot`.
- `bot.guild(id).members`, `.roles` are the cached `Collection`s (live); `.channels` is a
  `Collection` of that guild's cached channels, taken when you read it.
- `prefix: true` warns at startup when the client has no `MessageContent` intent.
