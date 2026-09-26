---
title: "@lunibee/voice"
description: Transport-agnostic voice session, audio playback and receive abstractions.
---

`@lunibee/voice` tracks voice sessions and moves audio through a player and receiver.
It does not open the voice WebSocket or UDP socket, encrypt packets or run the voice
heartbeat. You attach transports that do that with `attachTransports(gateway, udp)`.

## Installation

```bash
bun add @lunibee/voice
```

## Connect to voice

```ts
import { joinVoiceChannel, entersState, VoiceConnectionState } from "@lunibee/voice";

const voice = joinVoiceChannel({
  guildId: "123456789012345678",
  channelId: "987654321098765432",
  selfDeaf: true,
});
voice.attachTransports(myVoiceGatewayTransport, myUdpTransport);

voice.on("stateChange", (newState, oldState) => {
  console.log(`Voice state: ${oldState} → ${newState}`);
});
await entersState(voice, VoiceConnectionState.Connected, 5_000);
```

## What's included

- `VoiceConnection`: lifecycle state, channel and self mute/deaf, speaking updates, transport ownership.
- `AudioPlayer` / `AudioStream`: play, pause, resume and stop; override `onChunk()` to send audio.
- `VoiceReceiver`: routes incoming packets to per-user streams by SSRC.
- `@discordjs/voice`-style helpers: `joinVoiceChannel`, `getVoiceConnection`, `createAudioPlayer`, `createAudioResource`, `entersState`, `VoiceConnectionStatus`.

## When to use this package

Use `@lunibee/voice` when you need direct control over the voice connection or audio
pipeline. Text-only bots don't need it.
