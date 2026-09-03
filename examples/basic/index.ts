import { Client, GatewayIntentBits } from "lunibee";

const token = process.env.DISCORD_TOKEN;
if (!token) throw new Error("DISCORD_TOKEN is required");

const client = new Client({ token, intents: GatewayIntentBits.Guilds });

client.on("ready", user => {
    console.log(`Connected as ${user.username}`);
    console.log(`Ping: ${client.ping}ms`);
    console.log(`Invite link: ${client.generateInvite({ scopes: ["bot"], permissions: 8n })}`);
});

client.on("resumed", () => {
    console.log("Session resumed.");
});

client.on("invalidSession", isRecoverable => {
    console.log(`Session invalid. Recoverable: ${isRecoverable}`);
});

await client.login();
