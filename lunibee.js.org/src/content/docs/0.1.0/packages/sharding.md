---
title: "@lunibee/sharding"
description: Multi-process shard orchestration and event bus.
slug: 0.1.0/packages/sharding
---

# `@lunibee/sharding`

`@lunibee/sharding` coordinates multiple Gateway connections for large bots.

## Installation

```bash
bun add @lunibee/sharding
```

## Features

* `ShardManager`: Automated shard count fetching and spawning.
* `ShardBus`: Inter-shard pub/sub messaging and broadcast routing.
