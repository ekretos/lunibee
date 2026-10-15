---
title: Builder benchmarks
description: Cost of building and serialising Lunibee's builders.
---

Measured 2026-10-15 on Bun 1.4.2, Linux, a shared CPU. Absolute times move by about ±20% between runs and machines: compare ratios and orders of magnitude, not single digits.

Each row builds the object and calls `toJSON()`. Builders validate as they go, so the cost grows with the number of options.

| Operation | Median time |
| --- | ---: |
| CreateEmbed | 2.0 µs |
| CreateButton | 430 ns |
| CreateButton (link) | 718 ns |
| CreateActionRow (5 buttons) | 2.4 µs |
| CreateStringSelect (3 options) | 1.3 µs |
| CreateUserSelectMenu | 329 ns |
| CreateRoleSelectMenu | 430 ns |
| CreateMentionableSelectMenu | 566 ns |
| CreateChannelSelectMenu | 769 ns |
| CreateTextInput | 679 ns |
| CreateModal (2 inputs) | 1.9 µs |
| CreateTextDisplay | 126 ns |
| CreateSeparator | 109 ns |
| CreateThumbnail | 195 ns |
| CreateSection | 555 ns |
| CreateMediaGallery (2 items) | 769 ns |
| CreateFileComponent | 469 ns |
| CreateContentInventoryEntry | 133 ns |
| CreateContainer (text + separator + row) | 1.4 µs |
| CreateAttachment (no toJSON; construct + set) | 92 ns |
| CreateStringOption | 1.0 µs |
| CreateIntegerOption | 351 ns |
| CreateNumberOption | 263 ns |
| CreateBooleanOption | 289 ns |
| CreateUserOption | 239 ns |
| CreateRoleOption | 333 ns |
| CreateChannelOption | 987 ns |
| CreateMentionableOption | 533 ns |
| CreateAttachmentOption | 285 ns |
| CreateSlashCommand (3 options) | 1.8 µs |
| CreateSubcommand | 789 ns |
| CreateSubcommandGroup | 1.7 µs |
| CreateContextMenuCommand | 915 ns |
| CreateUserCommand | 373 ns |
| CreateMessageCommand | 177 ns |

`bun run build && bun scripts/bench-runtime.mjs`
