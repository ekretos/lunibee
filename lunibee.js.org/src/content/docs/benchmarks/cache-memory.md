---
title: Cache memory benchmarks
description: Heap kept per guild for small, medium and large guilds.
---

Measured 2026-10-15 on Bun 1.4.2, Linux, a shared CPU. Absolute times move by about ±20% between runs and machines: compare ratios and orders of magnitude, not single digits.

```text
size    guilds  members/guild  heap per guild
small      200             20        18.7 KiB
medium      50            500       294.5 KiB
large        5          10000      4682.9 KiB
```

`bun benchmarks/cache-memory.ts` feeds `GUILD_CREATE` payloads (roles, channels, members) to a client and reports the heap each guild keeps after a full GC. Users repeat across guilds, as they do on Discord. Members and their users dominate large guilds: turn off what a bot does not read with `cache: { members: false }` and the like.
