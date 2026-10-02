---
title: Architecture & Packages Overview
description: Overview of the layered package architecture in the Lunibee monorepo.
slug: 0.1.0/packages/overview
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
| [`@lunibee/core`](/0.1.0/packages/core/) | Orchestrates Client state machine, Gateway, and managers |
| [`@lunibee/ws`](/0.1.0/packages/ws/) | High-performance WebSocket Gateway connection & heartbeat ACK lifecycle |
| [`@lunibee/rest`](/0.1.0/packages/rest/) | Bucket-aware REST client with auto-retries and route definitions |
| [`@lunibee/builders`](/0.1.0/packages/builders/) | Strict compile-time and runtime validated builders for embeds & components |
| [`@lunibee/managers`](/0.1.0/packages/managers/) | Canonical resource cache managers for users, guilds, channels, and messages |
| [`@lunibee/structures`](/0.1.0/packages/structures/) | Discord model instances (Guild, Channel, Message, User, Member) |
| [`@lunibee/collection`](/0.1.0/packages/collection/) | High-speed cache collection with size bounds and TTL eviction |
| [`@lunibee/sharding`](/0.1.0/packages/sharding/) | Multi-process shard manager and inter-shard event bus |
| [`@lunibee/voice`](/0.1.0/packages/voice/) | Voice Gateway and audio streaming |
| [`@lunibee/formatters`](/0.1.0/packages/formatters/) | Discord markdown and timestamp formatters |
| [`@lunibee/utils`](/0.1.0/packages/utils/) | Snowflake verification and shared utilities |
| [`@lunibee/types`](/0.1.0/packages/types/) | Complete Discord API v10 and gateway TypeScript type definitions |
