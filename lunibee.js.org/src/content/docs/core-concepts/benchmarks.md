---
title: Benchmarks
description: Measured Collection, REST scheduling, Gateway event and cache-memory figures for 0.3.0, and how to reproduce them.
---

Figures from one machine (Bun 1.3.14, Linux, shared CPU) on 0.3.0. Absolute times move by about ±20% between runs and machines, so read the ratios. Every number can be reproduced with the commands in the last column.

| What | Result | Reproduce |
| --- | --- | --- |
| REST scheduling, 10 channels x 50 messages, 5 requests per 100 ms per channel, 60 ms latency | sequential 164 req/s, concurrent (default since 0.3.0) 316 req/s, both with 0 rate-limit errors | `bun run bench:rest` |
| Gateway: `MESSAGE_CREATE` | 4.0 µs per event, cache included | `bun benchmarks/gateway-events.ts` |
| Gateway: `GUILD_MEMBER_UPDATE` / `GUILD_ROLE_UPDATE` | 7.7 µs / 5.1 µs | same |
| Gateway: `GUILD_CREATE` with 50 members and 20 roles | 269 µs | same |
| Cache memory per guild: 10 members, 5 roles, 10 channels | 11.5 KiB | `bun benchmarks/cache-memory.ts` |
| Cache memory per guild: 200 members, 20 roles, 40 channels | 107 KiB | same |
| Cache memory per guild: 2,000 members, 60 roles, 120 channels | 682 KiB | same |
| `Collection` against discord.js: plain `set` / `get` | 1.3-1.4x / 1.2x its time; `filter`, `find`, `at` equal; `random` 8x faster | `bun benchmarks/collection.ts` |
| `Collection.at(500)` of 1,000 items | 1.2 µs (35 µs before 0.3.0, which copied the collection) | `bun scripts/bench-runtime.mjs` after `bun run build` |
| Empty `Collection` | 35 bytes (a `Map`: 32) | `bun benchmarks/collection.ts` |

## What the numbers mean

- **REST.** The fake Discord enforces real fixed windows, so the gain comes from using a bucket's whole allowance at once instead of one request at a time. It matters when the round trip is longer than the bucket's window divided by its limit. Pass `concurrentBuckets: false` to keep strict per-bucket ordering.
- **Cache memory.** If a bot only needs some of this, turn it off with `cache: { members: false }` and the like. The members and their users dominate large guilds.
- **Regressions.** `bun run bench:compare` runs the runtime benchmark several times, scales it by how fast this machine runs a plain `Map` against the committed baseline, and warns on anything more than 15% slower. It runs in CI and only warns.
