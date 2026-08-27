import { Client, GatewayIntentBits } from "lunibee";

const token = process.env.DISCORD_TOKEN;
if (!token) throw new Error("DISCORD_TOKEN is required");

const client = new Client({ token, intents: GatewayIntentBits.Guilds });

client.on("ready", user => {
    console.log(`Connected as ${user.username}`);
});

await client.login();
