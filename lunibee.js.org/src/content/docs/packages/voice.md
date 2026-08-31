---
title: "@lunibee/voice"
description: Discord Voice Gateway connection and audio streaming abstractions.
---

The `@lunibee/voice` package provides the low-level pieces needed to connect to Discord voice channels and manage the voice WebSocket/UDP lifecycle.

## Installation

```bash
bun add @lunibee/voice
```

## Connect to Voice

```ts
import { VoiceConnection } from "@lunibee/voice";

const voice = new VoiceConnection({
  guildId: "123456789012345678",
  channelId: "987654321098765432",
  selfDeaf: true,
  selfMute: false,
});

voice.on("stateChange", (oldState, newState) => {
  console.log(`Voice state: ${oldState} → ${newState}`);
});
```

The connection handles the Discord voice handshake and UDP encryption setup. Listen for state changes so your application can react to connection, reconnect, and disconnect transitions.

## When to use this package

Use `@lunibee/voice` when you need direct control over the voice connection or audio pipeline. If your application only needs text channels, messages, commands, or interactions, you do not need this package.
