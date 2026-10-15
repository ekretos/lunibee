---
title: Builder benchmarks
description: Cost of building and serialising Lunibee's builders.
---

Measured 2026-10-15 on Bun 1.4.2, Linux, a shared CPU. Absolute times move by about ±20% between runs and machines: compare ratios and orders of magnitude, not single digits.

Each row builds the object and calls `toJSON()`. Builders validate as they go, so the cost grows with the number of options.

| Operation | Median time |
| --- | ---: |
| CreateEmbed | 8.2 µs |
| CreateButton | 2.6 µs |
| CreateButton (link) | 1.3 µs |
| CreateActionRow (5 buttons) | 15.3 µs |
| CreateStringSelect (3 options) | 6.7 µs |
| CreateUserSelectMenu | 805 ns |
| CreateRoleSelectMenu | 717 ns |
| CreateMentionableSelectMenu | 509 ns |
| CreateChannelSelectMenu | 2.6 µs |
| CreateTextInput | 1.4 µs |
| CreateModal (2 inputs) | 2.5 µs |
| CreateTextDisplay | 74 ns |
| CreateSeparator | 80 ns |
| CreateThumbnail | 230 ns |
| CreateSection | 307 ns |
| CreateMediaGallery (2 items) | 4.5 µs |
| CreateFileComponent | 122 ns |
| CreateContentInventoryEntry | 129 ns |
| CreateContainer (text + separator + row) | 4.0 µs |
| CreateAttachment (no toJSON; construct + set) | 68 ns |
| CreateStringOption | 5.0 µs |
| CreateIntegerOption | 1.1 µs |
| CreateNumberOption | 1.4 µs |
| CreateBooleanOption | 931 ns |
| CreateUserOption | 1.1 µs |
| CreateRoleOption | 1.0 µs |
| CreateChannelOption | 2.8 µs |
| CreateMentionableOption | 611 ns |
| CreateAttachmentOption | 644 ns |
| CreateSlashCommand (3 options) | 7.3 µs |
| CreateSubcommand | 3.6 µs |
| CreateSubcommandGroup | 4.1 µs |
| CreateContextMenuCommand | 686 ns |
| CreateUserCommand | 396 ns |
| CreateMessageCommand | 512 ns |

`bun run build && bun scripts/bench-runtime.mjs`
