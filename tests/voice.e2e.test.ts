/**
 * End to end, in CI: a Client joins through `client.voice`, plays an Ogg/Opus
 * file and receives a user's audio, against the scripted voice server in
 * helpers/fake-voice-server.ts (real WebSocket and UDP on localhost, its own
 * decryption). It is a replay of the protocol, not a capture of Discord: the
 * final check against Discord itself is the maintainer's smoke test.
 */
import { afterEach, describe, expect, test } from "bun:test";
import { Client } from "../packages/core/src/index.ts";
import {
    SILENCE_FRAME,
    VoiceOpcodes,
    createAudioPlayer,
    createAudioResource,
    createOpusCodec,
    demuxOggOpus,
    entersState,
} from "../packages/voice/src/index.ts";
import { startFakeVoiceServer } from "./helpers/fake-voice-server.ts";

const OGG = new URL("./fixtures/audio/tone-1s.ogg", import.meta.url).pathname;
const cleanup: (() => unknown)[] = [];
afterEach(async () => {
    for (const fn of cleanup.splice(0).reverse()) await fn();
});

async function until<T>(
    check: () => T | undefined | false,
    ms = 5000,
): Promise<T> {
    const end = Date.now() + ms;
    for (;;) {
        const value = check();
        if (value) return value;
        if (Date.now() > end) throw new Error("until() timed out");
        await Bun.sleep(5);
    }
}

const GUILD = "100000000000000001";
const CHANNEL = "100000000000000002";
const BOT = "100000000000000003";
const FRIEND = "100000000000000004";

describe("voice end to end", () => {
    for (const mode of [
        "aead_aes256_gcm_rtpsize",
        "aead_xchacha20_poly1305_rtpsize",
    ]) {
        test(`join, play a file, receive a user, leave (${mode})`, async () => {
            const server = await startFakeVoiceServer({ modes: [mode] });
            cleanup.push(() => server.stop());
            const bot = new Client({ token: "a.b", intents: [] });
            cleanup.push(() => bot.destroy());
            const gateway = bot.gateway as unknown as Record<string, unknown>;
            const op4: (string | null)[] = [];
            gateway.sendVoiceState = (_g: string, channelId: string | null) => {
                op4.push(channelId);
                // Discord answers op 4 with the two voice events.
                if (channelId)
                    queueMicrotask(() => {
                        bot.gateway.emit("VOICE_STATE_UPDATE", {
                            guild_id: GUILD,
                            channel_id: channelId,
                            user_id: BOT,
                            session_id: "sess",
                        });
                        bot.gateway.emit("VOICE_SERVER_UPDATE", {
                            guild_id: GUILD,
                            token: "tok",
                            endpoint: server.endpoint,
                        });
                    });
                return true;
            };
            bot.gateway.emit("READY", {
                v: 10,
                user: {
                    id: BOT,
                    username: "bot",
                    discriminator: "0",
                    bot: true,
                },
                guilds: [],
                session_id: "gw",
                resume_gateway_url: "wss://x",
                application: { id: "1" },
            });

            const connection = await bot.voice.join({
                guildId: GUILD,
                channelId: CHANNEL,
                dave: false,
                networking: { url: server.url },
            });
            const player = createAudioPlayer();
            connection.subscribe(player);
            player.play(createAudioResource(OGG));
            await entersState(player, "playing", 1000);
            await until(() => player.state === "idle" && !player.ticking, 4000);

            // Every packet of the file arrived, in order, decrypted by the server, then 5 silence frames.
            const expected: number[][] = [];
            for await (const packet of demuxOggOpus(
                Bun.file(OGG).stream() as never,
            ))
                expected.push([...packet]);
            // UDP delivery trails the player's last tick.
            await until(
                () => server.state.packets.length === expected.length + 5,
            );
            const got = server.state.packets.map((p) => [...p.payload]);
            expect(server.state.decryptFailures).toBe(0);
            expect(got.slice(0, expected.length)).toEqual(expected);
            expect(got.slice(expected.length)).toEqual(
                Array.from({ length: 5 }, () => [...SILENCE_FRAME]),
            );
            const seqs = server.state.packets.map((p) => p.sequence);
            for (let i = 1; i < seqs.length; i++)
                expect(seqs[i]).toBe((seqs[i - 1]! + 1) & 0xffff);
            expect(server.state.speaking[0]).toEqual({
                speaking: 1,
                delay: 0,
                ssrc: server.ssrc,
            });
            expect(server.state.speaking.at(-1)).toEqual({
                speaking: 0,
                delay: 0,
                ssrc: server.ssrc,
            });

            // Receive: a friend speaks; their Opus decodes to PCM.
            server.json(VoiceOpcodes.Speaking, {
                user_id: FRIEND,
                ssrc: 31337,
                speaking: 1,
            });
            const stream = connection.receiver.subscribe(FRIEND, {
                end: { behavior: "silence", duration: 200 },
            });
            await Bun.sleep(30);
            for (let i = 0; i < 5; i++)
                server.sendAudio(
                    31337,
                    Uint8Array.from(expected[10 + i]!),
                    i + 1,
                );
            const reader = stream.getReader();
            const received: Uint8Array[] = [];
            for (;;) {
                const { done, value } = await reader.read();
                if (done) break;
                received.push(value);
            }
            expect(received.map((f) => [...f])).toEqual(expected.slice(10, 15));
            const codec = await createOpusCodec();
            expect(codec.decode(received[0]!).length).toBe(3840);
            codec.destroy();

            bot.voice.leave(GUILD);
            expect(op4).toEqual([CHANNEL, null]);
            expect(connection.status).toBe("destroyed");
            expect(player.subscribers.size).toBe(0);
        }, 15_000);
    }
});
