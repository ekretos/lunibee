---
title: Gateway event benchmarks
description: What the client spends on each Gateway dispatch.
---

Measured 2026-10-15 on Bun 1.4.2, Linux, a shared CPU. Absolute times move by about ±20% between runs and machines: compare ratios and orders of magnitude, not single digits.

## Core events

```text
GUILD_CREATE (50 members, 20 roles)  146.24 us/event
GUILD_MEMBER_UPDATE                  3.58 us/event
MESSAGE_CREATE                       2.08 us/event
GUILD_ROLE_UPDATE                    2.26 us/event
```

`bun benchmarks/gateway-events.ts` feeds dispatch payloads straight to the client's handlers (no socket) and includes cache synchronisation.

## Every dispatch

Each row feeds one event to a client with the default cache.

| Operation | Median time |
| --- | ---: |
| READY | 1.2 µs |
| RESUMED | 274 ns |
| GUILD_CREATE (50 members, 20 roles, 10 channels) | 175.5 µs |
| GUILD_UPDATE | 7.9 µs |
| GUILD_DELETE | 2.9 µs |
| GUILD_MEMBER_ADD | 4.5 µs |
| GUILD_MEMBER_UPDATE | 6.1 µs |
| GUILD_MEMBER_REMOVE | 778 ns |
| GUILD_MEMBERS_CHUNK (10 members) | 45.6 µs |
| GUILD_BAN_ADD | 581 ns |
| GUILD_BAN_REMOVE | 490 ns |
| GUILD_ROLE_CREATE | 1.7 µs |
| GUILD_ROLE_UPDATE | 2.9 µs |
| GUILD_ROLE_DELETE | 326 ns |
| GUILD_EMOJIS_UPDATE (10 emojis) | 15.6 µs |
| GUILD_STICKERS_UPDATE (5 stickers) | 3.5 µs |
| GUILD_INTEGRATIONS_UPDATE | 269 ns |
| GUILD_SCHEDULED_EVENT_CREATE | 408 ns |
| GUILD_SCHEDULED_EVENT_UPDATE | 435 ns |
| GUILD_SCHEDULED_EVENT_DELETE | 391 ns |
| GUILD_SCHEDULED_EVENT_USER_ADD | 621 ns |
| GUILD_SCHEDULED_EVENT_USER_REMOVE | 435 ns |
| GUILD_SOUNDBOARD_SOUND_CREATE | 420 ns |
| GUILD_SOUNDBOARD_SOUND_UPDATE | 354 ns |
| GUILD_SOUNDBOARD_SOUND_DELETE | 310 ns |
| GUILD_SOUNDBOARD_SOUNDS_UPDATE (5 sounds) | 4.4 µs |
| CHANNEL_CREATE | 1.5 µs |
| CHANNEL_UPDATE | 2.0 µs |
| CHANNEL_DELETE | 357 ns |
| CHANNEL_PINS_UPDATE | 64 ns |
| THREAD_CREATE | 2.2 µs |
| THREAD_UPDATE | 2.8 µs |
| THREAD_DELETE | 607 ns |
| THREAD_LIST_SYNC (5 threads) | 8.4 µs |
| THREAD_MEMBERS_UPDATE | 584 ns |
| THREAD_MEMBER_UPDATE | 653 ns |
| MESSAGE_CREATE | 6.5 µs |
| MESSAGE_UPDATE | 3.4 µs |
| MESSAGE_DELETE | 638 ns |
| MESSAGE_DELETE_BULK (10 ids) | 4.7 µs |
| MESSAGE_REACTION_ADD | 348 ns |
| MESSAGE_REACTION_REMOVE | 374 ns |
| MESSAGE_REACTION_REMOVE_ALL | 230 ns |
| MESSAGE_REACTION_REMOVE_EMOJI | 202 ns |
| MESSAGE_POLL_VOTE_ADD | 363 ns |
| MESSAGE_POLL_VOTE_REMOVE | 384 ns |
| STAGE_INSTANCE_CREATE | 484 ns |
| STAGE_INSTANCE_UPDATE | 432 ns |
| STAGE_INSTANCE_DELETE | 376 ns |
| INVITE_CREATE | 183 ns |
| INVITE_DELETE | 273 ns |
| WEBHOOKS_UPDATE | 67 ns |
| VOICE_STATE_UPDATE | 371 ns |
| VOICE_SERVER_UPDATE | 174 ns |
| PRESENCE_UPDATE | 271 ns |
| TYPING_START | 298 ns |
| AUTO_MODERATION_RULE_CREATE | 625 ns |
| AUTO_MODERATION_RULE_UPDATE | 724 ns |
| AUTO_MODERATION_RULE_DELETE | 584 ns |
| AUTO_MODERATION_ACTION_EXECUTION | 421 ns |
| ENTITLEMENT_CREATE | 751 ns |
| ENTITLEMENT_UPDATE | 788 ns |
| ENTITLEMENT_DELETE | 685 ns |
| INTERACTION_CREATE (button) | 1.6 µs |

`bun run build && bun scripts/bench-runtime.mjs`
