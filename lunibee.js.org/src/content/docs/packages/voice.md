---
title: "@lunibee/voice"
description: Discord voice for Bun — voice gateway v8, UDP, transport and DAVE end-to-end encryption, Opus, FFmpeg, player and receiver.
---

`@lunibee/voice` connects a bot to Discord voice and plays audio: the voice gateway (v8), IP discovery and RTP over UDP, transport encryption (`aead_aes256_gcm_rtpsize`, `aead_xchacha20_poly1305_rtpsize`), DAVE end-to-end encryption through `@snazzah/davey`, Ogg/Opus passthrough, Opus encoding, FFmpeg, a 20 ms player, a receiver, recording to Ogg/Opus, and effects (pitch shift, robot, echo) for a live voice changer. `lunibee` wires it to the client as `client.voice`.

```ts
const connection = await bot.voice.join({ guildId, channelId });
```

Without a Lunibee `Client`, give `joinVoiceChannel()` an adapter that sends op 4 and forwards the bot's voice events:

```ts
import { joinVoiceChannel } from "@lunibee/voice";

declare function sendOp4(payload: unknown): boolean;
const connection = joinVoiceChannel({
  guildId,
  channelId,
  adapterCreator: (methods) => {
    // call methods.onVoiceStateUpdate / onVoiceServerUpdate from your Gateway
    return { sendPayload: (payload) => sendOp4(payload), destroy: () => {} };
  },
});
```

Dependencies: `@noble/ciphers` (XChaCha20-Poly1305, audited, pure JS; AES-GCM uses the runtime's `node:crypto`) and `@lunibee/ws` (heartbeat). Optional peers: `@snazzah/davey` (DAVE, required by Discord outside stage channels), `opusscript` (Opus encoding when the system has no libopus). With libopus installed, the package's own `Opus` codec uses it through `bun:ffi`.

Guide: [Voice](/core-concepts/voice/). Reference: [Voice reference](/reference/voice-connection/).
