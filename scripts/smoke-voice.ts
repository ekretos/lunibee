/**
 * Release smoke test for voice, against real Discord: the built `lunibee`
 * package joins a voice channel, plays a 1-minute file (generated with
 * FFmpeg), and leaves cleanly. Needs a bot in the guild with Connect and Speak.
 *
 *   DISCORD_TOKEN=… VOICE_GUILD_ID=… VOICE_CHANNEL_ID=… bun run build && bun scripts/smoke-voice.ts
 */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
    AudioPlayerStatus,
    Client,
    GatewayIntentBits,
    VoiceConnectionStatus,
    createAudioPlayer,
    createAudioResource,
    entersState,
    generateDependencyReport,
} from "../dist/index.js";

const {
    DISCORD_TOKEN: token,
    VOICE_GUILD_ID: guildId,
    VOICE_CHANNEL_ID: channelId,
} = process.env;
if (!token || !guildId || !channelId) {
    console.error("Set DISCORD_TOKEN, VOICE_GUILD_ID and VOICE_CHANNEL_ID.");
    process.exit(2);
}

const step = (message: string) => console.log(`ok   ${message}`);
const dir = await mkdtemp(join(tmpdir(), "lunibee-voice-"));
const file = join(dir, "tone-60s.ogg");
const ffmpeg = Bun.spawnSync([
    "ffmpeg",
    "-loglevel",
    "error",
    "-f",
    "lavfi",
    "-i",
    "sine=frequency=440:duration=60",
    "-ac",
    "2",
    "-ar",
    "48000",
    "-c:a",
    "libopus",
    file,
]);
if (ffmpeg.exitCode !== 0)
    throw new Error(`ffmpeg failed: ${ffmpeg.stderr.toString()}`);
console.log("deps", generateDependencyReport());

const bot = new Client({
    token,
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates],
});
const failures: string[] = [];
try {
    await bot.login();
    step("logged in");
    const connection = await bot.voice.join({
        guildId,
        channelId,
        selfDeaf: true,
        timeout: 20_000,
    });
    step(
        `joined (DAVE ${connection.endToEndEncrypted ? "on" : "off"}, ping ${connection.ping} ms)`,
    );
    const player = createAudioPlayer();
    connection.subscribe(player);
    const started = performance.now();
    const resource = createAudioResource(file);
    let error: unknown;
    player.on("error", (err: unknown) => (error = err));
    player.play(resource);
    await entersState(player, AudioPlayerStatus.Playing, 10_000);
    step("playing");
    await entersState(player, AudioPlayerStatus.Idle, 75_000);
    const seconds = (performance.now() - started) / 1000;
    if (error) failures.push(`player error: ${String(error)}`);
    if (resource.playbackDuration < 59_000)
        failures.push(
            `played ${resource.playbackDuration} ms, expected ~60000`,
        );
    step(
        `played ${(resource.playbackDuration / 1000).toFixed(1)} s of audio in ${seconds.toFixed(1)} s`,
    );
    if (!bot.voice.leave(guildId)) failures.push("leave() found no connection");
    if (connection.status !== VoiceConnectionStatus.Destroyed)
        failures.push(`status after leave: ${connection.status}`);
    if (bot.voice.connections.size !== 0)
        failures.push("connection still tracked");
    step("left");
} catch (err) {
    failures.push(String(err));
} finally {
    bot.destroy();
    await rm(dir, { recursive: true, force: true });
}
if (failures.length) {
    for (const failure of failures) console.error(`FAIL ${failure}`);
    process.exit(1);
}
console.log("\nvoice smoke test passed");
process.exit(0);
