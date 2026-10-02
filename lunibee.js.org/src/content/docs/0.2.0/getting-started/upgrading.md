---
title: Upgrading to 0.2.0
description: Code changes needed when upgrading from 0.1.8 to 0.2.0.
slug: 0.2.0/getting-started/upgrading
---

Most bots need no changes. Check each item below that applies to you.

## Message cache is opt-in

Messages are no longer cached. If you read old message content on
`messageUpdate` / `messageDelete`, or call `channels.messages(id).resolve()`
expecting a cache hit, enable a bounded cache:

```ts
const client = new Client({
  token,
  intents,
  messageCache: { maxSize: 200, ttl: 30 * 60_000 },
});

client.on("messageUpdate", (message, previous) => {
  // previous: the cached version before the edit, if it was still cached
});
client.on("messageDelete", (data, message) => {
  // message: the cached message that was deleted, if any
});
```

With the cache enabled, messages from `MESSAGE_CREATE` and REST are cached.
The previous version is only available for messages that arrived while the
client was running and are still within the cache's `maxSize` and `ttl`.

## Builders throw on incomplete components

`toJSON()` now rejects components Discord would reject. Typical fixes:

```ts
// Before: accepted locally, rejected by Discord
new ButtonBuilder().setCustomId("ok");
// After: give it a label or an emoji
new ButtonBuilder().setCustomId("ok").setLabel("OK");

// A select must be alone in its action row, and needs a custom ID.
new ActionRowBuilder().addComponents(
  new StringSelectBuilder().setCustomId("pick").addOptions({ label: "A", value: "a" }),
);
```

## `bulkDeleteMessages()`

* A single ID is now allowed (it becomes a normal delete); an empty list throws.
* Messages older than 14 days throw a `RangeError` before any request. Delete
  those one by one with `deleteMessage()`.

## Cached objects are updated in place

Updates from the Gateway and `upsert()` modify the object you already hold
instead of swapping in a new one. By the time a `guildUpdate` (or member,
role, channel) handler runs, the cached object already has the new values, so
copying fields inside the handler cannot recover the old state. If you need a
before/after comparison, keep your own snapshot of the fields you care about
(for example when you first see the resource) and compare against it in the
handler. Messages are the exception: `messageUpdate` receives the previous
cached message as its second argument.

## `RESTError.path` is redacted

Webhook and interaction tokens in `error.path` (and REST hook contexts) are
replaced with `:token`. Log `error.path` freely; if you parsed the token out
of it, keep the token from where you created the request instead.
