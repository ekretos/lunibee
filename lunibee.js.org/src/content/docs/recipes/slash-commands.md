---
title: Slash Command Deployment
description: Registering and deploying global and guild application slash commands.
---


Before Discord users can use your slash commands, they must be registered via the REST API.

## Global vs Guild Commands

- **Guild Commands**: Update instantly. Ideal for development and testing.
- **Global Commands**: Available across all servers and DMs. Can take up to an hour to propagate globally.

## Deploying Commands

Create a deployment script `scripts/deploy-commands.ts`:

```ts
import { REST, Routes } from "lunibee";
const rest = new REST({ token: process.env.DISCORD_TOKEN! });
const commands = [
  {
    name: "ping",
    description: "Replies with Pong and latency information.",
  },
  {
    name: "userinfo",
    description: "Get information about a user.",
    options: [
      {
        name: "target",
        description: "The user to lookup",
        type: 6, // USER type
        required: false,
      },
    ],
  },
];
console.log("Registering guild application commands...");
await rest.put(
  Routes.applicationGuildCommands(process.env.CLIENT_ID!, process.env.GUILD_ID!),
  { body: commands }
);
console.log("Commands registered successfully!");
```

Run with Bun:

```bash
bun run scripts/deploy-commands.ts
```
