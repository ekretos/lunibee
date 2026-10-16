// The examples/basic bot, run as one cluster of scripts/smoke-cluster.ts.
// Only the Gateway address differs: it points at the fake Discord.
import {
    Client,
    ClusterWorker,
    Gateway,
    GatewayIntentBits,
    command,
} from "../../dist/index.js";

const gatewayURL = process.env.SMOKE_GATEWAY_URL!;
const connect = Gateway.prototype.connect;
Gateway.prototype.connect = function () {
    return connect.call(this, gatewayURL);
};

const worker = ClusterWorker.current()!;
const { shardIds, shardCount } = worker.context;
let ready = 0;
for (const shardId of shardIds) {
    const bot = new Client({
        token: process.env.DISCORD_TOKEN!,
        intents: [GatewayIntentBits.Guilds],
        gateway: { shardId, shardCount },
        rest: { baseURL: process.env.SMOKE_REST_URL! },
    });
    bot.commands.add(
        command({
            name: "ping",
            description: "Show the gateway latency",
            async run({ reply }) {
                await reply(`Pong from shard ${shardId}!`);
            },
        }),
    );
    bot.once("ready", async () => {
        await bot.commands.deploy();
        if (++ready === shardIds.length) worker.ready();
    });
    bot.commands.listen();
    await bot.login();
}
