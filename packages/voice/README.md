# @lunibee/voice

> Transport-agnostic voice sessions, audio playback and receiving.

`@lunibee/voice` tracks voice sessions and moves audio through a player and receiver. It
does **not** open the voice WebSocket or UDP socket, encrypt packets or run the voice
heartbeat. You attach transports that do, and Lunibee handles lifecycle, speaking state
and audio routing.

```bash
bun add @lunibee/voice
```

```ts
import {
    joinVoiceChannel,
    entersState,
    AudioPlayer,
    createAudioResource,
    SpeakingFlags,
    VoiceConnectionState,
    type VoiceGatewayTransport,
    type VoiceUdpTransport,
} from "@lunibee/voice";

declare const gatewayTransport: VoiceGatewayTransport;
declare const udpTransport: VoiceUdpTransport;
declare const opusStream: ReadableStream<Uint8Array>;

class UdpPlayer extends AudioPlayer {
    protected override onChunk(chunk: Uint8Array): void {
        void udpTransport.send(chunk, "203.0.113.1", 50000);
    }
}

const connection = joinVoiceChannel({
    guildId: "123456789012345678",
    channelId: "223456789012345678",
    selfDeaf: true,
});
connection.attachTransports(gatewayTransport, udpTransport);
await entersState(connection, VoiceConnectionState.Connected, 5_000);

const player = new UdpPlayer();
connection.setSpeaking(SpeakingFlags.Microphone);
await player.play(createAudioResource(opusStream));
player.on("finish", () => connection.destroy());
```

## What's inside

- `VoiceConnection`: states `disconnected` / `connecting` / `connected` / `destroyed`,
  `setChannel`, `setSuppression`, `setSpeaking`, `attachTransports`, `receiver`.
  Its `stateChange` passes `(next, previous)`.
- `AudioPlayer` / `AudioStream`: `play`, `pause`, `resume`, `stop`; override `onChunk`.
  Its `stateChange` passes `(from, to)`.
- `VoiceReceiver`: `mapSsrc`, `subscribe(userId)`, `onPacket`.
- `@discordjs/voice`-style helpers: `joinVoiceChannel`, `getVoiceConnection`,
  `createAudioPlayer`, `createAudioResource`, `entersState`, `VoiceConnectionStatus`.

Docs: https://lunibee.js.org/core-concepts/voice/
