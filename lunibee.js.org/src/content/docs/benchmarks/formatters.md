---
title: Formatter benchmarks
description: Cost of the mention, timestamp and text-style helpers.
---

Measured 2026-10-15 on Bun 1.4.2, Linux, a shared CPU. Absolute times move by about ±20% between runs and machines: compare ratios and orders of magnitude, not single digits.

These are string builders; the costs are tens to hundreds of nanoseconds.

| Operation | Median time |
| --- | ---: |
| userMention | 83 ns |
| channelMention | 73 ns |
| roleMention | 60 ns |
| timestamp | 101 ns |
| bold | 31 ns |
| italic | 29 ns |
| underline | 32 ns |
| strikethrough | 26 ns |
| spoiler | 26 ns |
| masked | 32 ns |
| inlineCode | 31 ns |
| codeBlock | 239 ns |
| blockQuote | 196 ns |
| heading | 55 ns |
| subtext | 32 ns |
| orderedList | 245 ns |
| bulletList | 125 ns |
| escapeMarkdown | 598 ns |
| parseUserMention | 238 ns |
| parseRoleMention | 172 ns |
| parseChannelMention | 225 ns |

`bun run build && bun scripts/bench-runtime.mjs`
