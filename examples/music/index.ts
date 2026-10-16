// bun examples/music/index.ts
// A small music bot: /play <file or URL>, /skip, /queue, /stop and /leave.
// Needs `@snazzah/davey` (Discord requires end-to-end encrypted voice) and,
// for anything that is not an Ogg/Opus file, `ffmpeg` on the PATH.
import {
    Client,
    GatewayIntentBits,
    command,
    createAudioPlayer,
    createAudioResource,
    option,
    type AudioPlayer,
    type AudioResource,
    type VoiceConnection,
} from "lunibee";

const token = process.env.DISCORD_TOKEN;
if (!token) throw new Error("DISCORD_TOKEN is required");

const bot = new Client({
    token,
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates],
});

/** One queue per guild: the player, its connection, and what is waiting. */
interface GuildMusic {
    connection: VoiceConnection;
    player: AudioPlayer;
    queue: { source: string; requestedBy: string }[];
}
const music = new Map<string, GuildMusic>();

function playNext(guildId: string): void {
    const state = music.get(guildId);
    const next = state?.queue.shift();
    if (!state || !next) return;
    const resource: AudioResource<{ source: string; requestedBy: string }> =
        createAudioResource(next.source, {
            inputType: /\.(ogg|opus)$/i.test(next.source) ? "ogg/opus" : "arbitrary",
            metadata: next,
        });
    state.player.play(resource);
}

async function musicFor(guildId: string, channelId: string): Promise<GuildMusic> {
    const existing = music.get(guildId);
    if (existing && existing.connection.status !== "destroyed") return existing;
    const connection = await bot.voice.join({ guildId, channelId, selfDeaf: true });
    const player = createAudioPlayer();
    connection.subscribe(player);
    const state: GuildMusic = { connection, player, queue: [] };
    // When a track ends (or fails), play the next one.
    player.on("finish", () => playNext(guildId));
    player.on("error", (error, resource) => {
        console.error(`could not play ${(resource.metadata as { source: string }).source}:`, error.message);
        playNext(guildId);
    });
    connection.on("stateChange", (next) => {
        if (next === "destroyed") music.delete(guildId);
    });
    music.set(guildId, state);
    return state;
}

/** The voice channel the person who ran the command is in. */
function voiceChannelOf(guildId: string, userId: string): string | undefined {
    return bot.guilds.voiceStates(guildId).get(userId)?.channel_id ?? undefined;
}

bot.commands.add(
    command({
        name: "play",
        description: "Queue a file path or URL and play it in your voice channel",
        guildOnly: true,
        options: { source: option.string({ required: true, max: 500 }) },
        async run({ guildId, userId, options, reply, defer }) {
            const channelId = voiceChannelOf(guildId!, userId);
            if (!channelId) return reply("Join a voice channel first.");
            await defer();
            const state = await musicFor(guildId!, channelId);
            state.queue.push({ source: options.source, requestedBy: userId });
            if (state.player.state === "idle") playNext(guildId!);
            await reply(`Queued: ${options.source} (${state.queue.length} waiting)`);
        },
    }),
    command({
        name: "skip",
        description: "Skip the current track",
        guildOnly: true,
        async run({ guildId, reply }) {
            const state = music.get(guildId!);
            if (!state || state.player.state === "idle") return reply("Nothing is playing.");
            state.player.stop(); // "finish" is not emitted for a stop: start the next one here
            playNext(guildId!);
            await reply("Skipped.");
        },
    }),
    command({
        name: "queue",
        description: "Show what is playing and what is next",
        guildOnly: true,
        async run({ guildId, reply }) {
            const state = music.get(guildId!);
            const now = state?.player.resource?.metadata as { source: string } | undefined;
            const lines = state?.queue.map((track, i) => `${i + 1}. ${track.source}`) ?? [];
            await reply([`Now: ${now?.source ?? "nothing"}`, ...lines].join("\n").slice(0, 1900));
        },
    }),
    command({
        name: "stop",
        description: "Stop and clear the queue",
        guildOnly: true,
        async run({ guildId, reply }) {
            const state = music.get(guildId!);
            if (state) {
                state.queue.length = 0;
                state.player.stop();
            }
            await reply("Stopped.");
        },
    }),
    command({
        name: "leave",
        description: "Leave the voice channel",
        guildOnly: true,
        async run({ guildId, reply }) {
            bot.voice.leave(guildId!);
            await reply("Bye!");
        },
    }),
);

bot.once("ready", async (user) => {
    console.log(`Connected as ${user.username}`);
    await bot.commands.deploy();
});
bot.commands.listen();

for (const signal of ["SIGINT", "SIGTERM"] as const)
    process.on(signal, () => {
        bot.destroy(); // leaves every voice channel first
        process.exit(0);
    });

await bot.login();
