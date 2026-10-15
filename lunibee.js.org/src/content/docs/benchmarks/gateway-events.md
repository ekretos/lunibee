---
title: Gateway event benchmarks
description: What the client spends on each Gateway dispatch.
---

Measured 2026-10-15 on Bun 1.4.2, Linux, a shared CPU. Absolute times move by about ±20% between runs and machines: compare ratios and orders of magnitude, not single digits.

## Core events

```text
GUILD_CREATE (50 members, 20 roles)  84.73 us/event
GUILD_MEMBER_UPDATE                  1.57 us/event
MESSAGE_CREATE                       1.95 us/event
GUILD_ROLE_UPDATE                    0.57 us/event
```

`bun benchmarks/gateway-events.ts` feeds dispatch payloads straight to the client's handlers (no socket) and includes cache synchronisation.

## Every dispatch

Each row feeds one event to a client with the default cache.

| Operation | Median time |
| --- | ---: |
| READY | 1.0 µs |
| RESUMED | 326 ns |
| GUILD_CREATE (50 members, 20 roles, 10 channels) | 100.6 µs |
| GUILD_UPDATE | 1.0 µs |
| GUILD_DELETE | 1.7 µs |
| GUILD_MEMBER_ADD | 1.7 µs |
| GUILD_MEMBER_UPDATE | 1.9 µs |
| GUILD_MEMBER_REMOVE | 378 ns |
| GUILD_MEMBERS_CHUNK (10 members) | 17.7 µs |
| GUILD_BAN_ADD | 398 ns |
| GUILD_BAN_REMOVE | 302 ns |
| GUILD_ROLE_CREATE | 1.2 µs |
| GUILD_ROLE_UPDATE | 1.1 µs |
| GUILD_ROLE_DELETE | 308 ns |
| GUILD_EMOJIS_UPDATE (10 emojis) | 8.8 µs |
| GUILD_STICKERS_UPDATE (5 stickers) | 2.1 µs |
| GUILD_INTEGRATIONS_UPDATE | 134 ns |
| GUILD_SCHEDULED_EVENT_CREATE | 385 ns |
| GUILD_SCHEDULED_EVENT_UPDATE | 404 ns |
| GUILD_SCHEDULED_EVENT_DELETE | 289 ns |
| GUILD_SCHEDULED_EVENT_USER_ADD | 448 ns |
| GUILD_SCHEDULED_EVENT_USER_REMOVE | 453 ns |
| GUILD_SOUNDBOARD_SOUND_CREATE | 314 ns |
| GUILD_SOUNDBOARD_SOUND_UPDATE | 328 ns |
| GUILD_SOUNDBOARD_SOUND_DELETE | 369 ns |
| GUILD_SOUNDBOARD_SOUNDS_UPDATE (5 sounds) | 3.7 µs |
| CHANNEL_CREATE | 1.4 µs |
| CHANNEL_UPDATE | 1.1 µs |
| CHANNEL_DELETE | 403 ns |
| CHANNEL_PINS_UPDATE | 130 ns |
| THREAD_CREATE | 1.7 µs |
| THREAD_UPDATE | 1.6 µs |
| THREAD_DELETE | 593 ns |
| THREAD_LIST_SYNC (5 threads) | 8.1 µs |
| THREAD_MEMBERS_UPDATE | 845 ns |
| THREAD_MEMBER_UPDATE | 776 ns |
| MESSAGE_CREATE | 4.5 µs |
| MESSAGE_UPDATE | 2.7 µs |
| MESSAGE_DELETE | 576 ns |
| MESSAGE_DELETE_BULK (10 ids) | 4.6 µs |
| MESSAGE_REACTION_ADD | 385 ns |
| MESSAGE_REACTION_REMOVE | 387 ns |
| MESSAGE_REACTION_REMOVE_ALL | 267 ns |
| MESSAGE_REACTION_REMOVE_EMOJI | 235 ns |
| MESSAGE_POLL_VOTE_ADD | 388 ns |
| MESSAGE_POLL_VOTE_REMOVE | 374 ns |
| STAGE_INSTANCE_CREATE | 432 ns |
| STAGE_INSTANCE_UPDATE | 406 ns |
| STAGE_INSTANCE_DELETE | 366 ns |
| INVITE_CREATE | 205 ns |
| INVITE_DELETE | 192 ns |
| WEBHOOKS_UPDATE | 92 ns |
| VOICE_STATE_UPDATE | 482 ns |
| VOICE_SERVER_UPDATE | 158 ns |
| PRESENCE_UPDATE | 303 ns |
| TYPING_START | 358 ns |
| AUTO_MODERATION_RULE_CREATE | 655 ns |
| AUTO_MODERATION_RULE_UPDATE | 649 ns |
| AUTO_MODERATION_RULE_DELETE | 566 ns |
| AUTO_MODERATION_ACTION_EXECUTION | 469 ns |
| ENTITLEMENT_CREATE | 1.0 µs |
| ENTITLEMENT_UPDATE | 807 ns |
| ENTITLEMENT_DELETE | 670 ns |
| INTERACTION_CREATE (button) | 1.4 µs |

`bun run build && bun scripts/bench-runtime.mjs`
