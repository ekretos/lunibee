---
title: Component & Embed Builders
description: Compile-time-safe and runtime-validated Discord UI payload builders.
---

# Component & Embed Builders

`@lunibee/builders` provides strict builders that validate Discord constraints before network dispatch.

## Embed Builder

```ts
import { EmbedBuilder } from "lunibee";

const embed = new EmbedBuilder()
  .setTitle("Lunibee Status 🐝")
  .setDescription("All systems fully operational.")
  .setColor(0xf59e0b)
  .setThumbnail("https://example.com/icon.png")
  .addFields(
    { name: "Ping", value: "24ms", inline: true },
    { name: "Uptime", value: "99.99%", inline: true }
  )
  .setFooter({ text: "Powered by Bun & Lunibee" })
  .setTimestamp();
```

## Button & Action Row Builders

```ts
import { ActionRowBuilder, ButtonBuilder, ButtonStyle } from "lunibee";

const primaryBtn = new ButtonBuilder()
  .setCustomId("primary_action")
  .setLabel("Click Me!")
  .setStyle(ButtonStyle.Primary)
  .setEmoji("🚀");

const linkBtn = new ButtonBuilder()
  .setLabel("Documentation")
  .setStyle(ButtonStyle.Link)
  .setURL("https://github.com/Ekretos/lunibee");

const row = new ActionRowBuilder().addComponents(primaryBtn, linkBtn);

await channel.send({
  content: "Choose an option:",
  components: [row],
});
```

## Select Menu Builders

```ts
import { ActionRowBuilder, StringSelectBuilder } from "lunibee";

const select = new StringSelectBuilder()
  .setCustomId("select_role")
  .setPlaceholder("Select a role...")
  .addOptions(
    { label: "Developer", value: "dev", emoji: "💻" },
    { label: "Designer", value: "designer", emoji: "🎨" }
  );

const row = new ActionRowBuilder().addComponents(select);
```
