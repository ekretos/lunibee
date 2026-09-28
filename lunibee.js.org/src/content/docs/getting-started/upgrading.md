---
title: Upgrading from 0.1.8
description: Code changes needed for the unreleased version after 0.1.8.
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
```

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

- A single ID is now allowed (it becomes a normal delete); an empty list throws.
- Messages older than 14 days throw a `RangeError` before any request. Delete
  those one by one with `deleteMessage()`.

## Cached objects are updated in place

Updates from the Gateway and `upsert()` modify the object you already hold
instead of swapping in a new one. If you compared old and new objects by
reference to detect a change, copy the fields you need before the update
(for example in your event handler) instead.

## `RESTError.path` is redacted

Webhook and interaction tokens in `error.path` (and REST hook contexts) are
replaced with `:token`. Log `error.path` freely; if you parsed the token out
of it, keep the token from where you created the request instead.
