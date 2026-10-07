import { Client, GatewayIntentBits, PermissionFlagsBits, command } from "lunibee";

const token = process.env.DISCORD_TOKEN;
if (!token) throw new Error("DISCORD_TOKEN is required");

const bot = new Client({ token, intents: GatewayIntentBits.Guilds });

bot.commands.add(
    command({
        name: "ping",
        description: "Show the gateway latency",
        async run({ bot, reply }) {
            await reply(`Pong! ${bot.ping}ms`);
        },
    }),
);

bot.once("ready", async user => {
    console.log(`Connected as ${user.username}`);
    console.log(`Invite link: ${bot.generateInvite({ scopes: ["bot", "applications.commands"], permissions: PermissionFlagsBits.Administrator })}`);
    await bot.commands.deploy();
});

bot.on("resumed", () => {
    console.log("Session resumed.");
});

bot.commands.listen();

await bot.login();
