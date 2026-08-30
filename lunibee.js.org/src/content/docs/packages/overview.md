---
title: Architecture & Packages Overview
description: Overview of the layered package architecture in the Lunibee monorepo.
---

# Architecture & Packages Overview

Lunibee is organized into strictly isolated workspace packages with enforced unidirectional layer dependencies.

```text
Layer 4:  lunibee  (Full facade)
             │
Layer 3:  @lunibee/core
             │
Layer 2:  @lunibee/managers ◄─── @lunibee/collection
             │
Layer 1:  @lunibee/structures ◄─ @lunibee/builders, @lunibee/rest, @lunibee/ws
             │
Layer 0:  @lunibee/types, @lunibee/utils, @lunibee/formatters
```

## Package Manifest

| Package | Purpose |
| :--- | :--- |
| [`@lunibee/core`](/packages/core/) | Orchestrates Client state machine, Gateway, and managers |
| [`@lunibee/ws`](/packages/ws/) | High-performance WebSocket Gateway connection & heartbeat ACK lifecycle |
| [`@lunibee/rest`](/packages/rest/) | Bucket-aware REST client with auto-retries and route definitions |
| [`@lunibee/builders`](/packages/builders/) | Strict compile-time and runtime validated builders for embeds & components |
| [`@lunibee/managers`](/packages/managers/) | Canonical resource cache managers for users, guilds, channels, and messages |
| [`@lunibee/structures`](/packages/structures/) | Discord model instances (Guild, Channel, Message, User, Member) |
| [`@lunibee/collection`](/packages/collection/) | High-speed cache collection with size bounds and TTL eviction |
| [`@lunibee/sharding`](/packages/sharding/) | Multi-process shard manager and inter-shard event bus |
| [`@lunibee/voice`](/packages/voice/) | Voice Gateway and audio streaming |
| [`@lunibee/formatters`](/packages/formatters/) | Discord markdown and timestamp formatters |
| [`@lunibee/utils`](/packages/utils/) | Snowflake verification and shared utilities |
| [`@lunibee/types`](/packages/types/) | Complete Discord API v10 and gateway TypeScript type definitions |
