---
title: Architecture & Packages Overview
description: Overview of the layered package architecture in the Lunibee monorepo.
---

Lunibee is organized into focused packages, but you do **not** need to understand the whole architecture to build a bot.

For a normal bot, start with the `lunibee` package. It gives you the high-level client and the common APIs. Reach for an individual `@lunibee/*` package when you need a specific low-level feature.

```text
Layer 4:  lunibee  (recommended entry point)
             │
Layer 3:  @lunibee/core
             │
Layer 2:  @lunibee/managers ◄─── @lunibee/collection
             │
Layer 1:  @lunibee/structures ◄─ @lunibee/builders, @lunibee/rest, @lunibee/ws
             │
Layer 0:  @lunibee/types, @lunibee/utils, @lunibee/formatters
```

## Which package do I need?

| If you want to... | Start with |
| :--- | :--- |
| Build a normal Discord bot | `lunibee` |
| Listen to events and manage the client | `@lunibee/core` |
| Send/edit/delete messages and work with resources | `@lunibee/structures` |
| Build commands, embeds, buttons, selects, or modals | `@lunibee/builders` |
| Call a Discord endpoint directly | `@lunibee/rest` |
| Work with caches or ID-based operations | `@lunibee/managers` / `@lunibee/collection` |
| Use Discord API types and constants | `@lunibee/types` |
| Connect directly to the Gateway | `@lunibee/ws` |
| Run multiple Gateway shards | `@lunibee/sharding` |
| Work with Discord voice | `@lunibee/voice` |
| Format mentions and timestamps | `@lunibee/formatters` |
| Use shared low-level helpers | `@lunibee/utils` |

## Package Manifest

| Package | Purpose |
| :--- | :--- |
| [`lunibee`](/packages/core/) | High-level bot client and public facade |
| [`@lunibee/core`](/packages/core/) | Client lifecycle, events, Gateway, REST, and managers |
| [`@lunibee/ws`](/packages/ws/) | WebSocket Gateway connection and heartbeat lifecycle |
| [`@lunibee/rest`](/packages/rest/) | Bucket-aware REST client and route definitions |
| [`@lunibee/builders`](/packages/builders/) | Validated embeds, commands, components, modals, and attachments |
| [`@lunibee/managers`](/packages/managers/) | Resource caches and ID-based operations |
| [`@lunibee/structures`](/packages/structures/) | Guild, Channel, Message, User, and Member resources |
| [`@lunibee/collection`](/packages/collection/) | In-memory collections and bounded caches |
| [`@lunibee/sharding`](/packages/sharding/) | Multi-shard management and inter-shard communication |
| [`@lunibee/voice`](/packages/voice/) | Discord Voice connection and audio primitives |
| [`@lunibee/formatters`](/packages/formatters/) | Mentions, timestamps, and Markdown helpers |
| [`@lunibee/utils`](/packages/utils/) | Shared low-level utilities |
| [`@lunibee/types`](/packages/types/) | Discord API v10 types and constants |

The package pages explain the public API and include examples. Start with the package that matches the task you are trying to accomplish; you can always move to a lower layer later.
