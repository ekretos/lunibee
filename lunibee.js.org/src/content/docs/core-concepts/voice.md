---
title: Voice
description: Discord Voice server connections, UDP audio streaming, and voice encryption.
---

# Voice

`@lunibee/voice` implements the Discord Voice Gateway protocol, encryption, and audio streaming.

## Connecting to Voice

```ts
import { VoiceConnection } from "@lunibee/voice";

const voice = new VoiceConnection({
  guildId: "123456789012345678",
  channelId: "987654321098765432",
  token: process.env.DISCORD_TOKEN!,
});

await voice.connect();
```

## Features

- **Voice Gateway v4**: Fast handshakes and heartbeat scheduling.
- **Audio Packet Encryption**: `xsalsa20_poly1305` and `aead_xchacha20_poly1305_ietf` support.
- **Opus Audio Streaming**: Low-latency PCM / Opus streaming over UDP.
