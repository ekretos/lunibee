---
title: Sending Messages
description: The typed options for send, edit, reply and follow-up, and what each one accepts.
---

Every way of sending a message takes the same shape, so one object works for a channel send, a
message reply, an interaction reply and a follow-up.

```ts
import { CreateEmbed } from "lunibee";

await bot.channel(channelId).send({
  content: "Report",
  embeds: [new CreateEmbed().setTitle("Weekly"), { title: "A raw embed works too" }],
  files: [{ name: "log.txt", data: "hello" }],
  allowed_mentions: { parse: [] },
});
```

| Type | Used by | Adds to the common fields |
| --- | --- | --- |
| `MessageCreateOptions` | `send()`, `message.reply()` | `files`, `message_reference`, `poll`, `sticker_ids`, `nonce`, `enforce_nonce` |
| `MessageEditOptions` | `edit()` | `files` |
| `InteractionReplyOptions` | `reply()`, `editReply()`, `followUp()`, `update()` | `ephemeral`, `withResponse`, `files`, `poll` |

The common fields are `content`, `embeds`, `components`, `allowed_mentions`, `flags`, `tts` and
`attachments`. Embeds and components may be builders or raw objects: a builder's `toJSON()` runs when
the request is sent. Keys Discord adds later still pass through, so new API fields work before the
types learn them. A wrong shape (`content: 1`, `embeds: [1]`, `ephemeral: "yes"`) is a compile error.

```ts
await interaction.reply({ content: "Only you can see this", ephemeral: true });
const message = await interaction.reply({ content: "Done", withResponse: true });
```
