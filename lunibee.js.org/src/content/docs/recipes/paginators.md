---
title: Paginator Component
description: Building an interactive embed paginator with buttons.
---


Here is a clean pattern for an interactive embed paginator using `EmbedBuilder` and `ButtonBuilder`:

```ts
import { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, type ChatInputCommandInteraction } from "lunibee";
export async function sendPaginator(interaction: ChatInputCommandInteraction, pages: string[]) {
  let currentIndex = 0;
  const buildEmbed = (index: number) => {
    return new EmbedBuilder()
      .setTitle(`Page ${index + 1} of ${pages.length}`)
      .setDescription(pages[index])
      .setColor(0xf59e0b)
      .setFooter({ text: "Use the buttons below to navigate" });
  };
  const buildButtons = (index: number) => {
    const prev = new ButtonBuilder()
      .setCustomId("page_prev")
      .setLabel("◀ Previous")
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(index === 0);
    const next = new ButtonBuilder()
      .setCustomId("page_next")
      .setLabel("Next ▶")
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(index === pages.length - 1);
    return new ActionRowBuilder().addComponents(prev, next);
  };
  await interaction.reply({
    embeds: [buildEmbed(currentIndex)],
    components: [buildButtons(currentIndex)],
  });
}
```
