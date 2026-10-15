---
title: Formatter benchmarks
description: Cost of the mention, timestamp and text-style helpers.
---

Measured 2026-10-15 on Bun 1.4.2, Linux, a shared CPU. Absolute times move by about ±20% between runs and machines: compare ratios and orders of magnitude, not single digits.

These are string builders; the costs are tens to hundreds of nanoseconds.

| Operation | Median time |
| --- | ---: |
| userMention | 143 ns |
| channelMention | 106 ns |
| roleMention | 55 ns |
| timestamp | 131 ns |
| bold | 28 ns |
| italic | 31 ns |
| underline | 23 ns |
| strikethrough | 33 ns |
| spoiler | 24 ns |
| masked | 25 ns |
| inlineCode | 28 ns |
| codeBlock | 179 ns |
| blockQuote | 107 ns |
| heading | 59 ns |
| subtext | 28 ns |
| orderedList | 120 ns |
| bulletList | 154 ns |
| escapeMarkdown | 577 ns |
| parseUserMention | 183 ns |
| parseRoleMention | 161 ns |
| parseChannelMention | 191 ns |

`bun run build && bun scripts/bench-runtime.mjs`
