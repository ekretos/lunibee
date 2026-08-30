---
title: "@lunibee/voice"
description: Discord Voice Gateway connection and audio streaming abstractions.
---

The `@lunibee/voice` package manages Discord Voice WebSocket and UDP encryption handshakes for connecting bots to voice channels.

## Installation

```bash
bun add @lunibee/voice
```

---

## `VoiceConnection`

```ts
import { VoiceConnection } from "@lunibee/voice";

const voice = new VoiceConnection({
  guildId: "123456789012345678",
  channelId: "987654321098765432",
  selfDeaf: true,
  selfMute: false,
});

voice.on("stateChange", (oldState, newState) => {
  console.log(`Voice state transitioned from ${oldState} to ${newState}`);
});
```
