import { Client } from "@lunibee/core";

const token = Bun.env.DISCORD_TOKEN;
if (!token) throw new Error("DISCORD_TOKEN is required.");

const client = new Client({ token, intents: 0 });
client.once("ready", user => console.log(`Logged in as ${user.username}`));
client.on("error", error => console.error(error));

await client.login();

for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.once(signal, () => client.destroy());
}
