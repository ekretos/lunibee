---
title: Threads, Forums & More
description: Forum posts and tags, thread members, bulk bans, onboarding, application emojis, role gradients and entitlements.
---

New in 0.3.0. Every method below sits on a manager you already have; `docs/audits/api-coverage.md` in the repository lists which Discord routes are covered.

## Forum and media channels

```ts
const forum = bot.channels.threads(forumId);

// One request: the post and its first message (files included).
await forum.createForumPost({
  name: "Crash on startup",
  message: { content: "It happens after the update.", files: [{ name: "log.txt", data: log }] },
  appliedTags: [bugTagId],
});

// Tags are read fresh and written whole, so edits never clobber newer ones.
await bot.channels.createForumTag(forumId, { name: "bug", moderated: true }, "new tag");
await bot.channels.editForumTag(forumId, bugTagId, { moderated: false });
await bot.channels.removeForumTag(forumId, oldTagId);
```

## Threads

```ts
const threads = bot.channels.threads(channelId);
const thread = await threads.create({ name: "planning", type: 11 });   // 11 public, 12 private
await threads.addMember(thread.id, userId);
const members = await threads.fetchMembers(thread.id, { withMember: true, limit: 50 });
const archived = await threads.fetchArchived("public", { limit: 25 }); // { threads, members, hasMore }
await threads.join(thread.id);
await threads.leave(thread.id);
```

## Moderation and members

```ts
const { banned, failed } = await bot.guilds.bans(guildId).bulk(spammerIds, { deleteMessageSeconds: 3600, reason: "raid" });
const matches = await bot.guilds.members(guildId).search("ali", 10);
await bot.guilds.members(guildId).editMe({ nick: "Bee" });
const guilds = await bot.users.fetchGuilds({ limit: 200 });   // one page; use `after` to continue
```

## Pins and typing

```ts
const { messages, hasMore } = await bot.channels.fetchPins(channelId, { limit: 20 });
await bot.channels.triggerTyping(channelId);
```

## Welcome screen, onboarding and stages

```ts
await bot.guilds.editWelcomeScreen(guildId, { enabled: true, description: "Say hi!" });
const onboarding = await bot.guilds.fetchOnboarding(guildId);
await bot.guilds.editVoiceState(guildId, "@me", { channelId: stageId, suppress: false }); // speak on a stage
```

## Application emojis

They belong to the bot, so every server shows them. Available after `ready`.

```ts
await bot.applicationEmojis!.create({ name: "bee", image: dataUri });
const all = await bot.applicationEmojis!.fetchAll();
```

## Role icons and gradients

```ts
await bot.guilds.roles(guildId).create({
  name: "Supporter",
  colors: { primary: 0xff8800, secondary: 0xffcc00 },   // add `tertiary` for the holographic style
  unicodeEmoji: "🐝",                                    // or `icon: dataUri` (needs the boost level)
});
```

`role.colors` is `{ primary, secondary, tertiary } | null`.

## Entitlements on interactions

```ts
bot.on("interactionCreate", async (interaction) => {
  if (interaction.isCommand() && !interaction.hasEntitlement(premiumSkuId))
    return interaction.reply({ content: "This needs the premium plan.", ephemeral: true });
});
```

`interaction.entitlements` lists the raw entitlements; `hasEntitlement()` checks one SKU is active (not deleted, not ended).

## Polls

`send()` takes a typed `poll`; `endPoll()` and `fetchPollVoters()` finish and read it.

```ts
await bot.channel(channelId).send({ poll: { question: { text: "Lunch?" }, answers: [{ poll_media: { text: "Pizza" } }, { poll_media: { text: "Sushi" } }], duration: 24 } });
```
