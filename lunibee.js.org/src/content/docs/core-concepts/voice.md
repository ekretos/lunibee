---
title: Voice
description: Discord Voice server connections, UDP audio streaming, and voice encryption.
---

# Voice

`@lunibee/voice` implements the Discord Voice Gateway protocol, encryption, and audio streaming.

## Connecting to Voice

You do not need to pass your bot token to voice connections. The client manages the voice handshake and receives a temporary session token from Discord's `VOICE_SERVER_UPDATE` event automatically.

```ts
import { VoiceConnection } from "@lunibee/voice";

const voice = new VoiceConnection({
  guildId: "123456789012345678",
  channelId: "987654321098765432",
  selfMute: false,
  selfDeaf: false,
});

voice.connect();
```

## Voice Connection Lifecycle

`VoiceConnection` manages the connection state machine (`disconnected`, `connecting`, `connected`, `destroyed`) and provides lifecycle hooks:

```ts
voice.on("stateChange", (newState, oldState) => {
  console.log(`Voice state changed from ${oldState} to ${newState}`);
});

voice.on("speaking", (flags, ssrc) => {
  console.log(`Speaking state changed: ${flags}`);
});
```

## Features

- **Voice Gateway Lifecycle**: Fast handshakes, state tracking, and heartbeat scheduling.
- **Audio Packet Encryption**: Modern AEAD & XSalsa20 voice transport encryption.
- **Transport Abstraction**: Plug-and-play Gateway & UDP transports.
