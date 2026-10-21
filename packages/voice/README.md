# @lunibee/voice

> Discord voice for Bun: join a channel, play audio, receive and record it, end-to-end encrypted.

`@lunibee/voice` speaks the voice gateway (v8), IP discovery and RTP over UDP, transport
encryption (`aead_aes256_gcm_rtpsize`, `aead_xchacha20_poly1305_rtpsize`) and DAVE end-to-end
encryption. It plays Ogg/Opus as it is, encodes PCM with its own Opus codec, and runs anything
else through FFmpeg. `lunibee` wires it to the client as `client.voice`.

```bash
bun add lunibee @snazzah/davey
# PCM, inlineVolume and effects need an Opus library: the system's libopus
# (apt install libopus0 / brew install opus), or `bun add opusscript`.
```

```ts
import { Client, GatewayIntentBits, createAudioPlayer, createAudioResource } from "lunibee";

const bot = new Client({ token: process.env.DISCORD_TOKEN!, intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates] });
await bot.login();

const connection = await bot.voice.join({ guildId: "123456789012345678", channelId: "223456789012345678", selfDeaf: true });
const player = createAudioPlayer();
connection.subscribe(player);
player.play(createAudioResource("./track.ogg"));
player.on("finish", () => bot.voice.leave("123456789012345678"));
```

## What's inside

- `client.voice` (`VoiceManager`): `join()`, `leave()`, `get()`, `connections`.
- `VoiceConnection`: statuses `signalling` → `connecting` → `ready`, `disconnected`, `destroyed`; moves, region changes and resumes; `subscribe(player)`, `receiver`, `endToEndEncrypted`, `voicePrivacyCode`.
- `AudioPlayer`: `idle`, `buffering`, `playing`, `paused`, `autopaused`; a 20 ms clock that corrects its drift.
- `createAudioResource(input, options)`: file paths, URLs, bytes or streams; Ogg/Opus passthrough, PCM, FFmpeg; `inlineVolume`, `effects` (`pitchShift`, `robot`, `echo`, `gain`), `live` sources.
- `VoiceReceiver`: `subscribe(userId)` gives Opus packets, `record(userId)` an Ogg/Opus stream.
- `Opus`: the Opus codec on the system's libopus through `bun:ffi` (native, nothing to compile); `createOpusCodec()` falls back to `opusscript`.
- The protocol layer for custom stacks: `VoiceNetworking`, `VoiceGateway`, `VoiceUdp`, `PacketCipher`, `DaveSession`.

`joinVoiceChannel({ adapterCreator, … })` connects without a Lunibee `Client`.

Docs: https://lunibee.js.org/core-concepts/voice/
